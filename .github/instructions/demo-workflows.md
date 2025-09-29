## Patterns to follow when creating demo workflows
- There are two types of demo workflows:
    1. those that just run actions in the repo (see [this](../actions/demo-dotnet-actions/action.yml))
    2. those that create tests and use [assert](../../src/testing/assert/action.yml)
- If the underlying composite action has testable code, use the type that uses [assert](../../src/testing/assert/action.yml). Otherwise use [this](../actions/demo-dotnet-actions/action.yml) as the pattern.
- Once the composite action is finish, make sure to create a new job in [demo-all.yml](../workflows/demo-all.yml) that checks out the code and then uses the new composite action.


<!-- ## Explicit Details
- The steps for a demo workflow will sit inside of a composite action (see [this](../actions/demo-get-project-and-solution-files-from-directory/action.yml) for an example)
- Each individual workflow consists of two steps:
    - check out the code
    - run the workflow's composite action
- demo workflows must have a summary section which prints out all of the tests, their assertions, and the result (see [this](../actions/demo-get-project-and-solution-files-from-directory/action.yml))
- Use .src/testing/assert/action.yml action when making assertions
- Make sure to follow the pattern established in [demo-get-project-and-solution-files-from-directory](../actions/demo-get-project-and-solution-files-from-directory/action.yml) whereby each demo workflow file is really just using a composite action.   -->

