# Calculate NPS Score

The system calculates and displays the NPS score.

## Page Context

This behavior is part of the **Analytics Page** at `/analytics`.

Other behaviors on this page:
- View Response Summary
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

### User views NPS score

#### Steps
* Act: Click on a survey with NPS responses
* Act: Click the "Analytics" tab
* Check: The NPS score is displayed
* Check: The breakdown shows Promoters, Passives, and Detractors

