# Todos

I want to create a new composite action called "get-parent-project".  The way it works is to take in a list of file paths as strings (see the output of get-changes-files) and finds the closest .csproj file going upward in the folder tree.  When going up, it only checks the files in the parent directory and stops when it finds a .csproj file.  Consider the following directory structure:

```
Messaging
├── Trafera.Messaging.Abstractions    
│   ├── src
|   |   └── Trafera.Messaging.Abstractions.csproj
│   ├── tests
|   |   └── Trafera.Messaging.Abstractions.Tests.csproj
|   └── README.md
|   └── CHANGELOG.md
|   └── Trafera.Messaging.Abstractions.sln
├── Trafera.Messaging.Project2    
│   ├── src
|   |   └── Trafera.Messaging.Project2.csproj
│   ├── tests
|   |   └── Trafera.Messaging.Project2.Tests.csproj
|   └── README.md
|   └── CHANGELOG.md
|   └── Trafera.Messaging.Project2.sln
├── Trafera.Messaging.Project3    
│   ├── src
|   |   └── Trafera.Messaging.Project3.csproj
│   ├── tests
|   |   └── Trafera.Messaging.Project3.Tests.csproj
|   └── README.md
|   └── CHANGELOG.md
|   └── Trafera.Messaging.Project3.sln
```

In this case, if the input file is `Messaging/Trafera.Messaging.Abstractions/src/SomeFile.cs`, the action should return `Messaging/Trafera.Messaging.Abstractions/src/Trafera.Messaging.Abstractions.csproj`. If the input file is `Messaging/Trafera.Messaging.Project2/tests/SomeTestFile.cs`, the action should return `Messaging/Trafera.Messaging.Project2/tests/Trafera.Messaging.Project2.Tests.csproj`. If the input file is `Messaging/Trafera.Messaging.Project3/README.md`, the action should return `Messaging/Trafera.Messaging.Project3/README.md` since there is no .csproj file in the same directory or any parent directory.

There should also be an input for pattern matching to only consider files that match the pattern.  So if the pattern is `.*\.cs`, then only file paths that end in `.cs` will be considered for finding the parent .csproj file.  In this case, if the input file is `Messaging/Trafera.Messaging.Project2/tests/SomeTestFile.md`, the action should just ignore that file path and return an empty string since it doesn't match the pattern.  If the input file is `Messaging/Trafera.Messaging.Project2/tests/subDir/anotherDir/SomeTestFile.cs`, then it should return `Messaging/Trafera.Messaging.Project2/tests/Trafera.Messaging.Project2.Tests.csproj` since it matches the pattern and there is a .csproj file in the same directory.

There should also be an input called "return-dir-only" which just returns the parent directory instead of the .csproj file path.

Please write extensive unit tests to get 100% coverage.  Also add a demo-workflow to test the composite action
