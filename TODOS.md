# Todos

I want to change how the composite action "get-unique-root-directories" works.  Currently, the implementation assumes that the root directories are always single project directories.  This is not always the case, and it can lead to incorrect results.  I want to change the implementation to be more flexible and to alos handle cases where there are multiple project directories.  Consider the following directory structure:

```
Messaging
├── Trafera.Messaging.Abstractions    
│   ├── src
|   |   └── Trafera.Messaging.Abstractions.csproj
│   └── tests
├── Trafera.Messaging.Project2
│   ├── src
|   |   └── Trafera.Messaging.Project2.csproj
│   └── tests
└── Trafera.Messaging.Project3
|   ├── src
|   |   └── Trafera.Messaging.Project3.csproj
|   └── tests
```

In this case, the current implementation of "get-unique-root-directories" would return "Messaging" as the root directory, but it should return three "Messaging/Trafera.Messaging.Abstractions", "Messaging/Trafera.Messaging.Project2", and "Messaging/Trafera.Messaging.Project3" directories.  I think the best way to implement this change is to check the current output for the presence of multiple projects and then use the parent directory for each project as an intermediary step to determine (based on the file path inputs) which root directories to return.  If none of the input file paths are located within the parent directory of a project, then that project should be excluded from the output.  This way, we can ensure that we are only returning the root directories that are relevant to the input file paths.  Please add new tests to cover this new functionality and ensure that it is working correctly.  Also make sure to update the documentation for the "get-unique-root-directories" action to reflect the new behavior.
