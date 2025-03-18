#!/bin/bash

# Check for correct usage
if [ $# -lt 1 ] || [ $# -gt 2 ]; then
    echo "Usage: $0 [directory] <file_extension>"
    exit 1
fi

# Set directory and extension based on arguments
if [ $# -eq 1 ]; then
    dir="."
    extension="$1"
else
    dir="$1"
    extension="$2"
fi

# Validate directory exists
if [ ! -d "$dir" ]; then
    echo "Error: Directory '$dir' does not exist"
    exit 1
fi

# Find all files with given extension recursively
find "$dir" -type f -name "*.$extension" -print0 | while IFS= read -r -d '' file; do
    # Get the relative path (as given by find)
    relative_path="$file"
    comment_line="// $relative_path"

    # Read the first line of the file
    first_line=$(head -n 1 "$file" 2>/dev/null)
    if [[ $? -ne 0 ]]; then
        echo "Error reading $file, skipping..."
        continue
    fi

    # Check if the first line is a shebang
    if [[ "$first_line" =~ ^#! ]]; then
        # Shebang found, check the second line
        second_line=$(sed -n '2p' "$file")

        if [[ "$second_line" != "$comment_line" ]]; then
            # Insert comment after shebang
            tmp=$(mktemp)
            {
                echo "$first_line"
                echo "$comment_line"
                tail -n +2 "$file"
            } > "$tmp" && mv "$tmp" "$file"
            echo "Added comment to $file"
        fi
    else
        # No shebang, check the first line
        if [[ "$first_line" != "$comment_line" ]]; then
            # Prepend comment
            tmp=$(mktemp)
            {
                echo "$comment_line"
                cat "$file"
            } > "$tmp" && mv "$tmp" "$file"
            echo "Added comment to $file"
        fi
    fi
done