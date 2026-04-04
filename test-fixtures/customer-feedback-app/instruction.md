# Customer Feedback App

A feedback and NPS (Net Promoter Score) application for collecting, analyzing, and acting on customer feedback through surveys.

## Pages

### Sign In Page
**Path:** `/sign-in`

#### Components
- **Email Input** - Text field for entering user email address
- **Password Input** - Text field for entering user password
- **Sign In Button** - Submits credentials to authenticate the user
- **Sign Up Link** - Link to navigate to the sign-up page

#### Behaviors
- Sign In

### Sign Up Page
**Path:** `/sign-up`

#### Components
- **Name Input** - Text field for entering user display name
- **Email Input** - Text field for entering user email address
- **Password Input** - Text field for entering user password
- **Sign Up Button** - Submits the registration form to create a new account
- **Sign In Link** - Link to navigate back to the sign-in page

#### Behaviors
- Sign Up

### Surveys Page
**Path:** `/surveys`

#### Components
- **Surveys List** - Displays all surveys with their status
- **Create Survey Button** - Opens the survey creation form
- **Delete Button** - Removes a survey from the list
- **Archive Button** - Archives a survey
- **Sign Out Button** - Logs the user out and returns to sign-in page

#### Behaviors
- Sign Out
- Create Survey
- Delete Survey
- Archive Survey

### Survey Detail Page
**Path:** `/surveys/:id`

#### Components
- **Survey Title** - Displays the survey title
- **Questions List** - Displays all questions in the survey
- **Add Question Button** - Opens the question creation form
- **Take Survey Button** - Opens the survey response form
- **Results Tab** - Shows survey response data

#### Behaviors
- Add NPS Question
- Add Text Question
- Add Multiple Choice Question
- Submit Survey Response

### Analytics Page
**Path:** `/analytics`

#### Components
- **Response Summary** - Displays aggregated response data
- **NPS Score Display** - Shows the calculated NPS score
- **Date Filter** - Filters responses by date range
- **Export Button** - Exports response data

#### Behaviors
- View Response Summary
- Calculate NPS Score
- Filter Responses by Date
- Export Responses

---

## Behaviors

### Sign Up

New users can create an account to manage feedback.

#### Rules

##### Account Created
- When:
  - User fills sign up form with valid data
- Then:
  - Account is created
  - User is signed in

#### Scenarios

##### User creates a new account

###### Steps
* Act: Navigate to http://localhost:3000/sign-up
* Act: Type "New Admin" into the name input field
* Act: Type "newadmin@feedback.com" into the email input field
* Act: Type "password123" into the password input field
* Act: Click the "Sign Up" button
* Check: The page displays a button to create a survey or navigate the application

---

### Sign In

Existing users can sign in to access their surveys.

#### Dependencies
1. Sign Up: User creates a new account

#### Rules

##### Invalid Credentials
- When:
  - User enters incorrect credentials
- Then:
  - Error message is displayed

##### Valid Credentials
- When:
  - User enters admin@feedback.com and demo123
- Then:
  - User is signed in
  - User sees surveys page

#### Scenarios

##### User enters wrong credentials

###### Steps
* Act: Navigate to http://localhost:3000/sign-in
* Act: Type "wrong@email.com" into the email input field
* Act: Type "wrongpassword" into the password input field
* Act: Click the "Sign In" button
* Check: An error message is displayed
* Check: The sign in form is still visible

##### User signs in successfully

###### Steps
* Act: Navigate to http://localhost:3000/sign-in
* Act: Type "admin@feedback.com" into the email input field
* Act: Type "demo123" into the password input field
* Act: Click the "Sign In" button
* Check: The page displays a button to create a survey or navigate the application

---

### Sign Out

Users can sign out of the application.

#### Dependencies
1. Sign Up: User creates a new account

#### Rules

##### Session Cleared
- When:
  - User clicks sign out
- Then:
  - User is redirected to sign in page

#### Scenarios

##### User signs out

###### Steps
* Act: Click the "Sign Out" button
* Check: The sign in form is displayed

---

### Create Survey

Users can create new feedback surveys.

#### Dependencies
1. Sign Up: User creates a new account

#### Rules

##### Survey Created
- When:
  - User fills survey form and saves
- Then:
  - Survey appears in surveys list

#### Scenarios

##### User creates a new survey

###### Steps
* Act: Click the "Create Survey" button
* Act: Type "Customer Satisfaction Q1 2024" into the survey title input field
* Act: Type "Help us improve our service" into the description input field
* Act: Click the "Save" button
* Check: The text "Customer Satisfaction Q1 2024" is visible on the page

---

### Add NPS Question

Users can add NPS (0-10 scale) questions to surveys.

#### Dependencies
1. Sign Up: User creates a new account
2. Create Survey: User creates a new survey

#### Rules

##### Question Added
- When:
  - User adds NPS question
- Then:
  - Question appears in survey with 0-10 scale

#### Scenarios

##### User adds an NPS question

###### Steps
* Act: Click the "Create Survey" button
* Act: Type "NPS Survey" into the survey title input field
* Act: Click the "Save" button
* Act: Click on the survey "NPS Survey"
* Act: Click the "Add Question" button
* Act: Select "NPS" as the question type
* Act: Type "How likely are you to recommend us?" into the question input field
* Act: Click the "Save" button
* Check: The text "How likely are you to recommend us?" is visible on the page

---

### Add Text Question

Users can add open-ended text questions to surveys.

#### Dependencies
1. Sign Up: User creates a new account
2. Create Survey: User creates a new survey

#### Rules

##### Question Added
- When:
  - User adds text question
- Then:
  - Question appears in survey

#### Scenarios

##### User adds a text question

###### Steps
* Act: Click the "Create Survey" button
* Act: Type "Feedback Survey" into the survey title input field
* Act: Click the "Save" button
* Act: Click on the survey "Feedback Survey"
* Act: Click the "Add Question" button
* Act: Select "Text" as the question type
* Act: Type "What could we do better?" into the question input field
* Act: Click the "Save" button
* Check: The text "What could we do better?" is visible on the page

---

### Add Multiple Choice Question

Users can add multiple choice questions to surveys.

#### Dependencies
1. Sign Up: User creates a new account
2. Create Survey: User creates a new survey

#### Rules

##### Question Added
- When:
  - User adds multiple choice question with options
- Then:
  - Question appears with all options

#### Scenarios

##### User adds a multiple choice question

###### Steps
* Act: Click the "Create Survey" button
* Act: Type "Source Survey" into the survey title input field
* Act: Click the "Save" button
* Act: Click on the survey "Source Survey"
* Act: Click the "Add Question" button
* Act: Select "Multiple Choice" as the question type
* Act: Type "How did you hear about us?" into the question text field
* Act: Click the "Save" button
* Check: The text "How did you hear about us?" is visible on the page

---

### Submit Survey Response

Respondents can complete and submit survey responses.

#### Dependencies
1. Sign Up: User creates a new account
2. Create Survey: User creates a new survey
3. Add NPS Question: User adds an NPS question

#### Rules

##### Response Recorded
- When:
  - User submits survey answers
- Then:
  - Confirmation is displayed
  - Response is recorded

#### Scenarios

##### User submits a response

###### Steps
* Act: Click on the survey "NPS Survey"
* Act: Click the "Take Survey" button
* Act: Click the "Submit" button
* Check: A confirmation message is displayed

---

### View Response Summary

Users can view aggregated survey responses.

#### Dependencies
1. Sign Up: User creates a new account
2. Create Survey: User creates a new survey
3. Add NPS Question: User adds an NPS question
4. Submit Survey Response: User submits a response

#### Rules

##### Summary Displayed
- When:
  - User views survey results
- Then:
  - Response count is shown
  - Response data is visible

#### Scenarios

##### User views responses

###### Steps
* Act: Click on the survey "NPS Survey"
* Act: Click the "Results" tab
* Check: The total number of responses is displayed

---

### Calculate NPS Score

The system calculates and displays the NPS score.

#### Dependencies
1. Sign Up: User creates a new account
2. Create Survey: User creates a new survey
3. Add NPS Question: User adds an NPS question
4. Submit Survey Response: User submits a response

#### Rules

##### Score Calculated
- When:
  - User views NPS analytics
- Then:
  - NPS score is displayed (-100 to 100)
  - Promoters, Passives, Detractors breakdown shown

#### Scenarios

##### User views NPS score

###### Steps
* Act: Click on the survey "NPS Survey"
* Act: Click the "Analytics" tab
* Check: The NPS score is displayed
* Check: The breakdown shows Promoters, Passives, and Detractors

---

### Delete Survey

Users can delete surveys from the system.

#### Dependencies
1. Sign Up: User creates a new account
2. Create Survey: User creates a new survey

#### Rules

##### Survey Removed
- When:
  - User deletes survey and confirms
- Then:
  - Survey is removed from list

#### Scenarios

##### User deletes a survey

###### Steps
* Act: Click the "Create Survey" button
* Act: Type "Delete Test Survey" into the survey title input field
* Act: Click the "Save" button
* Check: The text "Delete Test Survey" is visible on the page
* Act: Click the delete button for "Delete Test Survey"
* Act: Click the "Confirm" button in the modal
* Check: The text "Delete Test Survey" is no longer visible on the page

---

### Archive Survey

Users can archive surveys to keep them but hide from active list.

#### Dependencies
1. Sign Up: User creates a new account
2. Create Survey: User creates a new survey

#### Rules

##### Survey Archived
- When:
  - User archives survey
- Then:
  - Survey is moved to archived section

#### Scenarios

##### User archives a survey

###### Steps
* Act: Click the "Create Survey" button
* Act: Type "Archive Test Survey" into the survey title input field
* Act: Click the "Save" button
* Act: Click the archive button for "Archive Test Survey"
* Check: The text "Archived" is visible on the page

---

### Filter Responses by Date

Users can filter survey responses by date range.

#### Dependencies
1. Sign Up: User creates a new account
2. Create Survey: User creates a new survey
3. Add NPS Question: User adds an NPS question
4. Submit Survey Response: User submits a response

#### Rules

##### Results Filtered
- When:
  - User selects date range
- Then:
  - Only matching responses are shown

#### Scenarios

##### User filters by date

###### Steps
* Act: Click on the survey "NPS Survey"
* Act: Click the "Results" tab
* Act: Select a start date from the date picker
* Act: Select an end date from the date picker
* Check: The filtered responses are displayed

---

### Export Responses

Users can export survey response data.

#### Dependencies
1. Sign Up: User creates a new account
2. Create Survey: User creates a new survey
3. Add NPS Question: User adds an NPS question
4. Submit Survey Response: User submits a response

#### Rules

##### Data Exported
- When:
  - User clicks export
- Then:
  - Response data is downloaded or displayed

#### Scenarios

##### User exports responses

###### Steps
* Act: Click on the survey "NPS Survey"
* Act: Click the "Results" tab
* Act: Click the "Export" button
* Check: A confirmation message or download indicator is displayed
