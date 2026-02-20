# Coding Standards & Best Practices

This document outlines the coding standards and best practices for the `abroad-ui` project. Adherence to these guidelines ensures code maintainability, security, and using modern JavaScript features.

## 1. Modern JavaScript (ES2021+)

We target ES2021+. Please use the latest standard features where appropriate.

- **String Replacement**: Always prefer `String.replaceAll()` over `String.replace()` with global regex when replacing all occurrences.
  - ✅ `text.replaceAll('.', '')`
  - ✅ `text.replaceAll(/,/g, '.')`
  - ❌ `text.replace(/\./g, '')`
- **Number Parsing**: Use the explicit `Number` namespace methods.
  - ✅ `Number.parseInt('123', 10)`
  - ✅ `Number.parseFloat('123.45')`
  - ❌ `parseInt('123')` / `parseFloat('123.45')`

## 2. Cognitive Complexity

We strive to keep functions simple and readable.

- **Limit**: Methods should ideally have a Cognitive Complexity score under **15**.
- **Refactoring Strategy**:
  - Extract complex conditional logic into helper functions (e.g., `getNestedError`, `handleQuoteError`).
  - distinct UI sections into smaller functional components (e.g., `CurrencySelector`, `SwapInfo`).
  - Avoid deep nesting of `if/else` blocks; use early returns.

## 3. Security

- **Regular Expressions**: Ensure all Regex patterns are safe from ReDoS (Regular Expression Denial of Service). Avoid nested quantifiers like `(a+)+`.
  - ✅ `/^[^\s@]+@[^\s@\.]+(\.[^\s@\.]+)+$/` (for email)
- **Cross-Origin Communication**:
  - Never use `*` as the target origin in `postMessage`.
  - Always verify `event.origin` when receiving messages.
  - Use `import.meta.env.VITE_PARENT_ORIGIN` or a strict allowlist.

## 4. Code Structure

- **Helper Functions**: Extract repeatable logic to `src/shared/utils`.
- **Components**: Keep components focused. If a component grows too large (e.g., > 300 lines), consider splitting it or extracting sub-components.

## 5. TypeScript

- Avoid `any`. Use `unknown` with narrowing or specific types.
- Ensure strict null checks are respected.
