#!/usr/bin/env python3
"""PreToolUse guard: allow frontend source edits, refuse everything else.

Install at .claude/hooks/frontend-only-guard.py and register it with
assets/settings.frontend-only.json.

Why a hook rather than permission rules: patterns cannot express "everything except
abroad-ui". Deny is evaluated before allow, so a broad allow with narrow denies does
not compose. The negative logic has to live in code.

Blocking is `exit 2` -- a hard block that precedes permission evaluation and cannot
be overridden by an allow rule. stderr is returned to the model, so every refusal
says what to do instead.

Two things this deliberately does NOT treat as equivalent:

  * Hand-editing a generated file is refused. AGENTS.md forbids it and the edit
    would be overwritten by the next build anyway.
  * A build regenerating that same file is fine. `npm -w abroad-ui run build` runs
    prisma:generate and TSOA generation in the SERVER workspace before orval can
    read swagger.json, so the frontend genuinely cannot build without writing
    outside abroad-ui. Source is the boundary; build output is not.

Bash coverage is best-effort by nature -- no parser can decide what an arbitrary
subprocess will write. It recognises the common write constructs and refuses when
their target escapes the boundary. The backstop is server-side: deploy-frontend.yml
recomputes the diff against main and refuses to deploy anything non-frontend, so an
escape here still cannot reach production.
"""

import json
import os
import re
import shlex
import sys

ALLOWED_PREFIXES = ("abroad-ui/",)

# Inside abroad-ui but off-limits: generated output, dependency manifests, and the
# build/deploy configuration -- that last group is an escape from the boundary
# itself, since it changes what gets built and where it is published.
BLOCKED_WITHIN_FRONTEND = {
    "abroad-ui/src/api/index.ts",
    "abroad-ui/package.json",
    "abroad-ui/package-lock.json",
    "abroad-ui/vite.config.ts",
    "abroad-ui/orval.config.ts",
    "abroad-ui/firebase.json",
    "abroad-ui/.firebaserc",
}

BUILD_ARTIFACTS = (
    "abroad-server/src/app/http/routes.ts",
    "abroad-server/src/app/http/swagger.json",
    "abroad-ui/src/api/index.ts",
)

# Never writable by any route. `.claude/` is first because a guard the agent can
# rewrite is not a guard.
ALWAYS_BLOCKED = (".claude/", ".secrets/", ".git/", ".github/")

WRITE_COMMANDS = {
    "sed", "tee", "cp", "mv", "rm", "install", "truncate", "dd", "patch",
    "chmod", "chown", "ln", "mkdir", "rmdir", "touch", "shred",
}
WRITE_GIT_SUBCOMMANDS = {"checkout", "restore", "stash", "reset", "rm", "mv", "clean"}
# These take their write targets from inside a patch file rather than from the
# command line, so there is nothing on the command line to validate.
OPAQUE_GIT_SUBCOMMANDS = {"apply", "am"}

BUILD_COMMAND_RE = re.compile(
    r"^\s*(npm (ci|run |-w |exec |test)|npx |yarn |pnpm |tsc\b|vite\b|eslint\b|playwright\b|jest\b|vitest\b)"
)

# Inline interpreter code can open files directly, which no token scan will catch.
# Narrowly targeted: a blanket substring check over every command also blocks
# ordinary work that merely mentions a protected path, such as grepping it.
INLINE_CODE_RE = re.compile(r"\b(python3?|node|perl|ruby|php|bash|sh|zsh)\b[^|;]*\s-(c|e)\b")

SCRATCH_ROOTS = ("/tmp/", "/private/tmp/", "/var/folders/")


def refuse(reason: str) -> None:
    sys.stderr.write(reason + "\n")
    sys.exit(2)


def project_dir(cwd: str) -> str:
    return os.path.normpath(os.environ.get("CLAUDE_PROJECT_DIR") or cwd)


def classify(path: str, cwd: str):
    """Return (kind, value): 'scratch', 'outside', or 'repo' with a relative path."""
    absolute = os.path.normpath(path if os.path.isabs(path) else os.path.join(cwd, path))
    # Scratch space is tested on the ABSOLUTE path. Relativising first turns
    # /tmp/x into ../../../tmp/x, which then matches nothing and is wrongly blocked.
    if any(absolute.startswith(root) for root in SCRATCH_ROOTS):
        return "scratch", absolute
    rel = os.path.relpath(absolute, project_dir(cwd)).replace(os.sep, "/")
    if rel.startswith("../") or rel == "..":
        return "outside", absolute
    return "repo", rel


def path_is_writable(path: str, cwd: str, allow_artifacts: bool):
    kind, value = classify(path, cwd)
    if kind == "scratch":
        return True, ""
    if kind == "outside":
        return False, f"{value} is outside the repository"
    for blocked in ALWAYS_BLOCKED:
        if value.startswith(blocked):
            return False, f"{value} is never writable ({blocked} holds guard config, credentials or CI)"
    if allow_artifacts and value in BUILD_ARTIFACTS:
        return True, ""
    if value in BLOCKED_WITHIN_FRONTEND:
        if value in BUILD_ARTIFACTS:
            return False, f"{value} is generated, not source"
        return False, f"{value} is frontend build/dependency configuration, not source"
    if not value.startswith(ALLOWED_PREFIXES):
        return False, f"{value} is outside abroad-ui/"
    return True, ""


def check_edit(path: str, cwd: str) -> None:
    ok, why = path_is_writable(path, cwd, allow_artifacts=False)
    if not ok:
        refuse(
            f"Refused: {why}.\n"
            "This agent may only edit frontend source under abroad-ui/. Backend, "
            "database, infrastructure and CI changes need a human."
        )


def sed_file_operands(operands):
    """sed's first non-flag operand is the script, not a file."""
    files, seen_script, skip_next = [], False, False
    for token in operands:
        if skip_next:
            skip_next = False
            continue
        if token.startswith("-"):
            if token in ("-e", "-f"):
                skip_next = True
            continue
        if not seen_script:
            seen_script = True
            continue
        files.append(token)
    return files


def check_bash(command: str, cwd: str) -> None:
    if INLINE_CODE_RE.search(command):
        for blocked in ALWAYS_BLOCKED:
            if blocked in command:
                refuse(
                    f"Refused: inline interpreter code referencing {blocked}.\n"
                    "Scripts can open files directly, so this is not permitted."
                )

    is_build = bool(BUILD_COMMAND_RE.match(command))

    for match in re.finditer(r"(?<![0-9&])>>?\s*([^\s;|&()]+)", command):
        target = match.group(1)
        if target.startswith("&") or target.startswith("/dev/"):
            continue
        ok, why = path_is_writable(target, cwd, allow_artifacts=is_build)
        if not ok:
            refuse(f"Refused: output is redirected to a path where writing is not allowed - {why}.")

    try:
        tokens = shlex.split(command, comments=True)
    except ValueError:
        # Unparseable quoting plus a write verb is the shape of an obfuscated
        # escape; refuse rather than guess.
        if re.search(r"\b(" + "|".join(WRITE_COMMANDS) + r")\b", command):
            refuse("Refused: could not parse this command safely and it contains a write operation.")
        return

    for index, token in enumerate(tokens):
        base = os.path.basename(token)
        operands = tokens[index + 1:]

        if base == "patch" or (base == "git" and operands and operands[0] in OPAQUE_GIT_SUBCOMMANDS):
            label = f"git {operands[0]}" if base == "git" else base
            refuse(
                f"Refused: `{label}` applies changes listed inside a patch file, so the "
                "affected paths cannot be checked from the command line.\n"
                "Edit files under abroad-ui/ directly instead."
            )

        if base == "git" and operands and operands[0] in WRITE_GIT_SUBCOMMANDS:
            rest = operands[1:]
            # Paths come after `--`; anything before it is a revision (HEAD, a branch,
            # a SHA) and is not a filesystem target.
            if "--" in rest:
                explicit = [t for t in rest[rest.index("--") + 1:] if not t.startswith("-")]
            else:
                explicit = []
            if not explicit:
                refuse(
                    f"Refused: `git {operands[0]}` without explicit paths after `--` acts on "
                    "the whole working tree, which reaches far outside abroad-ui/.\n"
                    f"Scope it, e.g. `git {operands[0]} -- abroad-ui/<file>`."
                )
            for path in explicit:
                ok, why = path_is_writable(path, cwd, allow_artifacts=True)
                if not ok:
                    refuse(f"Refused: `git {operands[0]}` would rewrite {why}.")

        if base in WRITE_COMMANDS:
            if is_build:
                continue
            candidates = sed_file_operands(operands) if base == "sed" else \
                [t for t in operands if not t.startswith("-")]
            for path in candidates:
                if "/" not in path and "." not in path:
                    continue  # a flag value or subcommand, not a path
                ok, why = path_is_writable(path, cwd, allow_artifacts=is_build)
                if not ok:
                    refuse(f"Refused: `{base}` would write to {why}.")


def main() -> None:
    try:
        event = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)

    tool = event.get("tool_name", "")
    tool_input = event.get("tool_input", {}) or {}
    cwd = event.get("cwd") or os.getcwd()

    if tool in ("Edit", "Write", "NotebookEdit"):
        path = tool_input.get("file_path") or tool_input.get("notebook_path")
        if path:
            check_edit(path, cwd)
    elif tool == "Bash":
        command = tool_input.get("command", "")
        if command:
            check_bash(command, cwd)

    sys.exit(0)


if __name__ == "__main__":
    main()
