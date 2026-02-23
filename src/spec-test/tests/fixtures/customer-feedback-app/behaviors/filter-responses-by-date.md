# Filter Responses by Date

Users can filter survey responses by date range.

## Page Context

This behavior is part of the **Analytics Page** at `/analytics`.

Other behaviors on this page:
- View Response Summary
- Calculate NPS Score
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

### User filters by date

#### Steps
* Act: Click on a survey with responses
* Act: Click the "Results" tab
* Act: Select a start date from the date picker
* Act: Select an end date from the date picker
* Check: The filtered responses are displayed

