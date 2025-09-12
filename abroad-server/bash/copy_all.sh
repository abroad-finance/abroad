#!/bin/bash

# Hardcoded files and directories to process
FILES_AND_DIRS=(
    "src"
    "prisma/schema.prisma"
)

# Hardcoded list of accepted file extensions
ACCEPTED_EXTENSIONS=("ts" "prisma")

# Hardcoded list of files to ignore (by basename)
IGNORED_FILES=("routes.ts")

# Output file is first argument, default to concatenated.txt
OUTPUT_FILE="${1:-concatenated.txt}"

# Validate accepted extensions list
if [ ${#ACCEPTED_EXTENSIONS[@]} -eq 0 ]; then
    echo "Error: No accepted extensions specified" >&2
    exit 1
fi

# Validate each entry in FILES_AND_DIRS
for item in "${FILES_AND_DIRS[@]}"; do
    if [ ! -e "$item" ]; then
        echo "Error: '$item' does not exist" >&2
        exit 1
    fi
    if [ ! -d "$item" ] && [ ! -f "$item" ]; then
        echo "Error: '$item' is neither a file nor a directory" >&2
        exit 1
    fi
done

# Truncate output file
> "$OUTPUT_FILE"

# Process each entry
for item in "${FILES_AND_DIRS[@]}"; do
    if [[ -d "$item" ]]; then
        # Build find command arguments for accepted extensions
        find_args=()
        for ext in "${ACCEPTED_EXTENSIONS[@]}"; do
            find_args+=( -name "*.$ext" -o )
        done
        # Remove the last -o operator
        unset 'find_args[${#find_args[@]}-1]'
        
        # Build find command arguments for ignored files
        ignored_args=()
        for ignore in "${IGNORED_FILES[@]}"; do
            ignored_args+=( -not -name "$ignore" )
        done

        # Find and concatenate matching files in directory, excluding ignored files
        find "$item" -type f \( "${find_args[@]}" \) -and \( "${ignored_args[@]}" \) -exec cat {} + >> "$OUTPUT_FILE"
    elif [[ -f "$item" ]]; then
        # Check if file should be ignored based on its basename
        file_basename=$(basename "$item")
        for ignore in "${IGNORED_FILES[@]}"; do
            if [[ "$file_basename" == "$ignore" ]]; then
                echo "Info: Skipping ignored file '$item'" >&2
                continue 2
            fi
        done

        # Check if file extension is in accepted list
        file_ext="${item##*.}"
        for ext in "${ACCEPTED_EXTENSIONS[@]}"; do
            if [[ "$file_ext" == "$ext" ]]; then
                cat "$item" >> "$OUTPUT_FILE"
                continue 2
            fi
        done
        echo "Warning: Skipping '$item' with non-accepted .$file_ext extension" >&2
    fi
done

# Verify output
if [ -s "$OUTPUT_FILE" ]; then
    echo "Success: All accepted files (${ACCEPTED_EXTENSIONS[@]}) concatenated to $OUTPUT_FILE"
else
    echo "Warning: No accepted files found in specified files/directories" >&2
    rm -f "$OUTPUT_FILE"
    exit 2
fi
