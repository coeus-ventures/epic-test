# Add Multiple Choice Question

Users can add multiple choice questions to surveys.

## Page Context

This behavior is part of the **Survey Detail Page** at `/surveys/:id`.

Other behaviors on this page:
- Add NPS Question
- Add Text Question
- Submit Survey Response

**Important**: Make sure this page includes UI elements (links, buttons, forms) for ALL behaviors listed above.

## Dependencies

This behavior requires the following to be implemented first:

1. **sign-up**: User creates a new account
2. **create-survey**: User creates a new survey

Make sure your implementation integrates with these existing features.

## Examples

### User adds a multiple choice question

#### Steps
* Act: Click the "Create Survey" button
* Act: Type "Source Survey" into the survey title input field
* Act: Click the "Save" button
* Act: Click on the survey "Source Survey"
* Act: Click the "Add Question" button
* Act: Select "Multiple Choice" as the question type
* Act: Type "How did you hear about us?" into the question input field
* Act: Type "Social Media" into the first option input field
* Act: Type "Friend Referral" into the second option input field
* Act: Click the "Save" button
* Check: The text "How did you hear about us?" is visible on the page

