# TODOS

- add an input to check for existence of directories before adding them to the output list?  If they don't exist, then just use the value before transformation

## Prompt

I want to add a new input to this composite action called "useOriginalIfNonExistant".   When true, it will check for the existence of a transformed directory before adding it to the output list.  If it doesn't exist, then the non-transformed value will be used instead of the transformed one.