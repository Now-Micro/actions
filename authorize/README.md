# Authorization in GitHub Actions

The `authorize` action is a lightweight guard for GitHub workflows. It checks the current actor, repository, and workflow ref against a central policy file and stops the workflow when the actor is not allowed to run that workflow.

## `authorize`

The composite action wraps `authorize.js`, which reads `permissions.json` from the `authorize/` folder. That file defines which GitHub usernames are allowed to run each workflow in each repository. The action compares the current GitHub context to that policy and exits successfully only when the actor is authorized.

When the actor is allowed, the action logs a success message. When the actor is not allowed, it exits with code `1` and prints a clear reason so the workflow can fail fast.

## `populateUsers`

`populateUsers.js` is the companion script that helps maintain `users.json`. It fetches members from the `Now-Micro` GitHub organization, looks up each member's display name, and rewrites `users.json` as a simple map of GitHub login to a single name string.

If a name cannot be inferred, the script stores an empty string (`""`). The script also preserves existing stored names when possible, and it asks for confirmation before writing any changes.

## File Roles

- `permissions.json` is the authorization policy consumed by `authorize`.
- `users.json` is the name directory used to keep human-readable names aligned with GitHub logins.
- `populateUsers.js` updates `users.json` from the org members list.
- `authorize.js` uses `permissions.json` to decide whether a workflow actor is allowed to proceed.

## Typical Flow

1. Run `populateUsers.js` to refresh `users.json` from the organization.
2. Update `permissions.json` with the workflows and actors that should be allowed.
3. Use the `authorize` composite action at the start of protected workflows.
