# Submit Survey Response

Respondents can complete and submit survey responses.

## Page Context

This behavior is part of the **Survey Detail Page** at `/surveys/:id`.

Other behaviors on this page:
- Add NPS Question
- Add Text Question
- Add Multiple Choice Question

**Important**: Make sure this page includes UI elements (links, buttons, forms) for ALL behaviors listed above.

## Dependencies

This behavior requires the following to be implemented first:

1. **sign-up**: User creates a new account
2. **create-survey**: User creates a new survey
3. **add-nps-question**: User adds an NPS question

Make sure your implementation integrates with these existing features.

## Examples

### User submits a response

#### Steps
* Act: Click on a survey with questions
* Act: Click the "Take Survey" button
* Act: Select a score of 9 for the NPS question
* Act: Click the "Submit" button
* Check: A confirmation message is displayed

