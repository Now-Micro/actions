- need to test that nuget/nuget-source and any other action that has changed in this branch
- need to test that dotnet/build and any other action that has changed in this branch
  - CodeBits
  - Dice5

  - add a new composite action called get-match (also add a demo workflow and node tests) which takes a string and a regex and outputs the matches as an array (the parentheses mark the matches). Make sure to use js for the actual logic.