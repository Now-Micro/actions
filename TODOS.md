# Todos

## Prompt

I copied the workflow currently in reusable-pre-release from another repo where we store all of our libraries.  I copied the workflow in pre-release-comparison from a repo that only has one project in it.  I want you to use these two example to create a fully reusable workflow.  There should be an input which allows users to specify what kind of repo they are using.  E.g. isProjectRepo or isLibraryRepo.  The behavior of the reusable workflow will then be slightly different based on that input (e.g. the first job can be skipped if it's a project repo).  Please also add a demo and unit tests (make sure the test coverage is met by running)
