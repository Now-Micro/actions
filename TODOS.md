# Todos

- need to add a meaningful tests

## test prompt

please add tests to get the coverage to > 90%.  Make sure to include a test to cover the following cases:

1. A PR what just opened, so the runs are empty
2. A user cancelled the first run, so the fallback value should be used
3. The user let the first run pass (all jobs were successful), but cancelled the second run, so the current (3rd) run should use the sha for the first run

## prompt

I want you to create a composite action from this step.  It should take the following parameters:

1. job-name: the name of the job that must pass (required); corresponds to TEST_SETUP_STATUS logic in current impementation
2. request-size: currently 50 and is optional
3. retry-attempts: currently 3  and is optional
4. test-job-names: these jobs must either pass or be skipped. or is required and is a comma-separated list of jobs that have to match tache criteria; corresponds to TEST_JOB_EXISTS logic in current impementation
5. workflow-name: currently is "checks.yml" and is required

Be sure to add tests and a demo-workflow per the instructions.  Make sure to make the actual script a js file.  The js script should have the exact same functionality as the current bash implementation.
