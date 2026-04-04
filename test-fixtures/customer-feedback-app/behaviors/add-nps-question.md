# Add NPS Question

Users can add NPS (0-10 scale) questions to surveys.

## Page Context

This behavior is part of the **Survey Detail Page** at `/surveys/:id`.

Other behaviors on this page:
- Add Text Question
- Add Multiple Choice Question
- Submit Survey Response

**Important**: Make sure this page includes UI elements (links, buttons, forms) for ALL behaviors listed above.

## Dependencies

This behavior requires the following to be implemented first:

1. **sign-up**: User creates a new account
2. **create-survey**: User creates a new survey

Make sure your implementation integrates with these existing features.

## Examples

### User adds an NPS question

#### Steps
* Act: Click the "Create Survey" button
* Act: Type "NPS Survey" into the survey title input field
* Act: Click the "Save" button
* Act: Click on the survey "NPS Survey"
* Act: Click the "Add Question" button
* Act: Select "NPS" as the question type
* Act: Type "How likely are you to recommend us?" into the question input field
* Act: Click the "Save" button
* Check: The text "How likely are you to recommend us?" is visible on the page

