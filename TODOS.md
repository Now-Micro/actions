# TODOS

## Prompt

I want to create a new composite action called "github/release" that automates the process of creating a GitHub release. Below is the list of steps that i want you to generalize (i.e. make it reusable for different repositories and scenarios by using inputs and outputs):

- name: Download all artifacts
    uses: actions/download-artifact@v4
    with:
        path: release-artifacts

- name: Prepare release assets
    id: prepare-assets
    run: |
        mkdir -p release-packages
        find release-artifacts -type f \( -name "*.nupkg" -o -name "*.snupkg" -o -name "*.symbols.nupkg" \) -exec cp {} release-packages/ \;

        echo "Release packages:"
        ls -la release-packages/

        LIBRARY_NAME="${{ needs.validate-release.outputs.library_name }}"
        VERSION="${{ needs.validate-release.outputs.release_version }}"

        # Create release notes for library-specific release
        cat > RELEASE_NOTES.md << EOF
        # $LIBRARY_NAME v$VERSION

        ## 📦 Library Release
        This is a targeted release for **$LIBRARY_NAME** version **$VERSION**.

        ## 📥 Installation
        \`\`\`bash
        dotnet add package $LIBRARY_NAME --version $VERSION
        \`\`\`

        ## 🔧 Package Details
        EOF

        # List generated NuGet packages
        found_pkg=0
        for pkg in release-packages/*.nupkg release-packages/*.snupkg release-packages/*.symbols.nupkg; do
        if [ -f "$pkg" ]; then
            echo "- \`$(basename "$pkg")\`" >> RELEASE_NOTES.md
            found_pkg=1
        fi
        done
        if [ "$found_pkg" -eq 0 ]; then
        echo "- _No packages copied into release-packages/_" >> RELEASE_NOTES.md
        fi

        # Find and include changelog content if available
        CHANGELOG_CONTENT_FILE="release-artifacts/changelog-content-${LIBRARY_NAME}/changelog-${LIBRARY_NAME}.md"
        if [ -f "$CHANGELOG_CONTENT_FILE" ]; then
        echo -e "\n## 🔧 Updates\n" >> RELEASE_NOTES.md
        cat "$CHANGELOG_CONTENT_FILE" >> RELEASE_NOTES.md
        else
        # Fallback: Add commit log for this release version
        PREV_TAG=$(git tag --list "${LIBRARY_NAME}-v*" --sort=-v:refname | grep -v "${LIBRARY_NAME}-v${VERSION}$" | head -1 || true)

        if [ -n "$PREV_TAG" ]; then
            echo -e "\n## 📝 Commits in this release\n" >> RELEASE_NOTES.md
            git log --pretty=format:"- %s (%h) [%an]" "$PREV_TAG"..HEAD -- . | grep -i "$LIBRARY_NAME" || true >> RELEASE_NOTES.md || \
            git log --pretty=format:"- %s (%h) [%an]" "$PREV_TAG"..HEAD >> RELEASE_NOTES.md
        else
            echo -e "\n## 📝 Commits in this release\n" >> RELEASE_NOTES.md
            git log --pretty=format:"- %s (%h) [%an]" -- . | grep -i "$LIBRARY_NAME" || true >> RELEASE_NOTES.md || \
            git log --pretty=format:"- %s (%h) [%an]" >> RELEASE_NOTES.md
        fi

        echo -e "\n## 🔧 Updates\n" >> RELEASE_NOTES.md
        echo "This release includes updates to $LIBRARY_NAME." >> RELEASE_NOTES.md
        fi

        cat >> RELEASE_NOTES.md << EOF

        ## 📥 Installation via GitHub Packages
        Configure your NuGet source:
        \`\`\`bash
        dotnet nuget add source --username YOUR_USERNAME --password YOUR_PAT --store-password-in-clear-text --name github "https://nuget.pkg.github.com/${{ github.repository_owner }}/index.json"
        \`\`\`
        EOF

        echo "has_packages=$(ls release-packages/*.nupkg 2>/dev/null | wc -l)" >> $GITHUB_OUTPUT

- name: Create Git tag
    id: create-tag
    if: ${{ steps.prepare-assets.outputs.has_packages > 0 }}
    run: |
        git config user.name "github-actions[bot]"
        git config user.email "github-actions[bot]@users.noreply.github.com"

        LIBRARY_NAME="${{ needs.validate-release.outputs.library_name }}"
        VERSION="${{ needs.validate-release.outputs.release_version }}"

        TAG_NAME="${LIBRARY_NAME}-v${VERSION}"
        TAG_MESSAGE="Release ${LIBRARY_NAME} v${VERSION}"

        if git tag | grep -q "^${TAG_NAME}$"; then
        echo "Tag $TAG_NAME already exists, skipping tag creation"
        else
        git tag -a "$TAG_NAME" -m "$TAG_MESSAGE"
        git push origin "$TAG_NAME"
        echo "Created and pushed tag: $TAG_NAME"
        fi

        echo "tag_name=$TAG_NAME" >> $GITHUB_OUTPUT

- name: Create GitHub Release
    if: ${{ steps.prepare-assets.outputs.has_packages > 0 }}
    uses: softprops/action-gh-release@v1
    with:
        tag_name: ${{ steps.create-tag.outputs.tag_name }}
        name: ${{ format('{0} v{1}', needs.validate-release.outputs.library_name, needs.validate-release.outputs.release_version) }}
        body_path: RELEASE_NOTES.md
        files: |
        release-packages/*.nupkg
        release-packages/*.snupkg
        release-packages/*.symbols.nupkg
        draft: false
        prerelease: ${{ contains(needs.validate-release.outputs.release_version, '-') }}
    env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

Make sure to add tests, demos, and documentation for the new composite action.
