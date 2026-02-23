# Export Responses

Users can export survey response data.

## Page Context

This behavior is part of the **Analytics Page** at `/analytics`.

Other behaviors on this page:
- View Response Summary
- Calculate NPS Score
- Filter Responses by Date

**Important**: Make sure this page includes UI elements (links, buttons, forms) for ALL behaviors listed above.

## Dependencies

This behavior requires the following to be implemented first:

1. **sign-up**: User creates a new account
2. **create-survey**: User creates a new survey
3. **add-nps-question**: User adds an NPS question
4. **submit-survey-response**: User submits a response

Make sure your implementation integrates with these existing features.

## Examples

### User exports responses

#### Steps
* Act: Click on a survey with responses
* Act: Click the "Results" tab
* Act: Click the "Export" button
* Check: A confirmation message or download indicator is displayed

