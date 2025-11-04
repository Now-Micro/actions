## prompt 
I want you to create a composite action from this step.  It should take the following parameters:
1. job-name: the name of the job that must pass (required); corresponds to TEST_SETUP_STATUS logic in current impementation
2. request-size: currently 50 and is optional
3. retry-attempts: currently 3  and is optional
4. test-job-names: these jobs must either pass or be skipped. or is required and is a comma-separated list of jobs that have to match the criteria; corresponds to TEST_JOB_EXISTS logic in current impementation
5. workflow-name: currently is "checks.yml" and is required

Be sure to add tests and a demo-workflow per the instructions.  Make sure to make the actual script a js file.  The js script should have the exact same functionality as the current bash implementation