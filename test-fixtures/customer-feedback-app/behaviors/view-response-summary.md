# View Response Summary

Users can view aggregated survey responses.

## Page Context

This behavior is part of the **Analytics Page** at `/analytics`.

Other behaviors on this page:
- Calculate NPS Score
- Filter Responses by Date
- Export Responses

**Important**: Make sure this page includes UI elements (links, buttons, forms) for ALL behaviors listed above.

## Dependencies

This behavior requires the following to be implemented first:

1. **sign-up**: User creates a new account
2. **create-survey**: User creates a new survey
3. **add-nps-question**: User adds an NPS question
4. **submit-survey-response**: User submits a response

Make sure your implementation integrates with these existing features.

## Examples

### User views responses

#### Steps
* Act: Click on a survey that has responses
* Act: Click the "Results" tab
* Check: The total number of responses is displayed

