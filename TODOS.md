# Todos

I want to change how the composite action "get-unique-root-directories" works.  Currently, the implementation assumes that the root directories are always single project directories.  This is not always the case, and it can lead to incorrect results.  I want to change the implementation to be more flexible and to handle cases where there are multiple project directories.  Consider the following directory structure:

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

In this case, the current implementation of "get-unique-root-directories" would return "Messaging" as the root directory, which is not correct.  Instead, I want to change the implementation to return "Trafera.Messaging.Abstractions", "Trafera.Messaging.Project2", and "Trafera.Messaging.Project3" as the root directories in such cases.  This will allow the action to work correctly in cases where there are multiple project directories.  I think the best way to implement this change is to check the current output for the presence of multiple projects and then return the parent directory for each project as the new output.  