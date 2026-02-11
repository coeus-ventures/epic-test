# Help Desk App

A support ticket management application for tracking customer issues and providing assistance.

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
- Invalid Sign In

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

### Tickets Page
**Path:** `/tickets`

#### Components
- **Tickets List** - Displays all support tickets with their status and priority
- **New Ticket Button** - Opens the ticket creation form
- **Status Filter** - Dropdown to filter tickets by status
- **Priority Filter** - Dropdown to filter tickets by priority
- **Search Input** - Text field for searching tickets
- **Sign Out Button** - Logs the user out and returns to sign-in page

#### Behaviors
- Sign Out
- Create Ticket
- Filter Tickets by Status
- Filter Tickets by Priority
- Search Tickets

### Ticket Detail Page
**Path:** `/tickets/:id`

#### Components
- **Ticket Subject** - Displays the ticket subject
- **Ticket Description** - Displays the ticket description
- **Assignee Dropdown** - Assigns ticket to an agent
- **Status Dropdown** - Changes ticket status
- **Reply Input** - Text field for adding replies
- **Send Reply Button** - Submits a reply to the ticket
- **Resolve Button** - Marks the ticket as resolved
- **Add Internal Note Button** - Opens the internal note form

#### Behaviors
- Assign Ticket to Agent
- Add Reply to Ticket
- Change Ticket Status
- Resolve Ticket
- Add Internal Note

---

## Behaviors

### Sign Up

New support agents can create an account to access the help desk.

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
* Act: Type "New Agent" into the name input field
* Act: Type "newagent@company.com" into the email input field
* Act: Type "password123" into the password input field
* Act: Click the "Sign Up" button
* Check: The page displays a button to create a ticket or navigate the application

---

### Sign In

Support agents can sign in to access the help desk.

#### Dependencies
1. Sign Up: User creates a new account

#### Rules

##### Valid Credentials
- When:
  - User enters agent@company.com and demo123
- Then:
  - User is signed in
  - User sees tickets page

#### Scenarios

##### User signs in successfully

###### Steps
* Act: Navigate to http://localhost:3000/sign-in
* Act: Type "agent@company.com" into the email input field
* Act: Type "demo123" into the password input field
* Act: Click the "Sign In" button
* Check: The page displays a button to create a ticket or navigate the application

---

### Invalid Sign In

Users see an error when entering wrong credentials.

#### Dependencies
1. Sign Up: User creates a new account

#### Rules

##### Invalid Credentials
- When:
  - User enters incorrect credentials
- Then:
  - Error message is displayed

#### Scenarios

##### User enters wrong credentials

###### Steps
* Act: Navigate to http://localhost:3000/sign-in
* Act: Type "wrong@email.com" into the email input field
* Act: Type "wrongpassword" into the password input field
* Act: Click the "Sign In" button
* Check: An error message is displayed
* Check: The sign in form is still visible

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

### Create Ticket

Users can create new support tickets with issue details.

#### Dependencies
1. Sign Up: User creates a new account

#### Rules

##### Ticket Created
- When:
  - User fills ticket form and submits
- Then:
  - Ticket appears in tickets list

#### Scenarios

##### User creates a ticket

###### Steps
* Act: Click the "New Ticket" button
* Act: Type "Cannot login to my account" into the subject input field
* Act: Type "I keep getting an error message" into the description input field
* Act: Type "customer@example.com" into the customer email input field
* Act: Select "High" from the priority dropdown
* Act: Click the "Submit" button
* Check: The text "Cannot login to my account" is visible on the page

---

### Assign Ticket to Agent

Tickets can be assigned to specific support agents.

#### Dependencies
1. Sign Up: User creates a new account
2. Create Ticket: User creates a ticket

#### Rules

##### Ticket Assigned
- When:
  - User assigns ticket to agent
- Then:
  - Ticket shows assigned agent

#### Scenarios

##### User assigns a ticket

###### Steps
* Act: Click the "New Ticket" button
* Act: Type "Billing inquiry" into the subject input field
* Act: Type "Need clarification on invoice" into the description input field
* Act: Click the "Submit" button
* Act: Click on the ticket "Billing inquiry"
* Act: Select "Agent Smith" from the assignee dropdown
* Act: Click the "Save" button
* Check: The text "Agent Smith" is visible on the page

---

### Add Reply to Ticket

Agents can respond to customer tickets with replies.

#### Dependencies
1. Sign Up: User creates a new account
2. Create Ticket: User creates a ticket

#### Rules

##### Reply Added
- When:
  - User submits reply
- Then:
  - Reply appears in ticket conversation

#### Scenarios

##### User adds a reply

###### Steps
* Act: Click the "New Ticket" button
* Act: Type "Feature request" into the subject input field
* Act: Type "Would like dark mode" into the description input field
* Act: Click the "Submit" button
* Act: Click on the ticket "Feature request"
* Act: Type "Thank you for your suggestion." into the reply input field
* Act: Click the "Send Reply" button
* Check: The text "Thank you for your suggestion." is visible on the page

---

### Change Ticket Status

Agents can update ticket status as they work on issues.

#### Dependencies
1. Sign Up: User creates a new account
2. Create Ticket: User creates a ticket

#### Rules

##### Status Changed
- When:
  - User changes ticket status
- Then:
  - Ticket shows new status

#### Scenarios

##### User changes ticket status

###### Steps
* Act: Click the "New Ticket" button
* Act: Type "Status test ticket" into the subject input field
* Act: Click the "Submit" button
* Act: Click on the ticket "Status test ticket"
* Act: Select "In Progress" from the status dropdown
* Act: Click the "Save" button
* Check: The text "In Progress" is visible on the page

---

### Resolve Ticket

Agents can mark tickets as resolved.

#### Dependencies
1. Sign Up: User creates a new account
2. Create Ticket: User creates a ticket

#### Rules

##### Ticket Resolved
- When:
  - User resolves ticket
- Then:
  - Ticket shows resolved status

#### Scenarios

##### User resolves a ticket

###### Steps
* Act: Click the "New Ticket" button
* Act: Type "Password reset needed" into the subject input field
* Act: Click the "Submit" button
* Act: Click on the ticket "Password reset needed"
* Act: Type "Your password has been reset." into the reply input field
* Act: Click the "Send Reply" button
* Act: Click the "Resolve" button
* Check: The text "Resolved" is visible on the page

---

### Filter Tickets by Status

Users can filter the ticket list by status.

#### Dependencies
1. Sign Up: User creates a new account
2. Create Ticket: User creates a ticket

#### Rules

##### Results Filtered
- When:
  - User selects status filter
- Then:
  - Only matching tickets are shown

#### Scenarios

##### User filters by status

###### Steps
* Act: Click the "New Ticket" button
* Act: Type "Open ticket" into the subject input field
* Act: Click the "Submit" button
* Act: Click the "New Ticket" button
* Act: Type "Another ticket" into the subject input field
* Act: Click the "Submit" button
* Act: Click on the ticket "Open ticket"
* Act: Select "Resolved" from the status dropdown
* Act: Click the "Save" button
* Act: Click the "Tickets" button in the navigation
* Act: Select "Open" from the status filter
* Check: The text "Another ticket" is visible on the page

---

### Filter Tickets by Priority

Users can filter tickets by priority level.

#### Dependencies
1. Sign Up: User creates a new account
2. Create Ticket: User creates a ticket

#### Rules

##### Results Filtered
- When:
  - User selects priority filter
- Then:
  - Only matching tickets are shown

#### Scenarios

##### User filters by priority

###### Steps
* Act: Click the "New Ticket" button
* Act: Type "Urgent issue" into the subject input field
* Act: Select "High" from the priority dropdown
* Act: Click the "Submit" button
* Act: Click the "New Ticket" button
* Act: Type "Minor question" into the subject input field
* Act: Select "Low" from the priority dropdown
* Act: Click the "Submit" button
* Act: Select "High" from the priority filter
* Check: The text "Urgent issue" is visible on the page

---

### Add Internal Note

Agents can add internal notes visible only to the support team.

#### Dependencies
1. Sign Up: User creates a new account
2. Create Ticket: User creates a ticket

#### Rules

##### Note Added
- When:
  - User adds internal note
- Then:
  - Note is visible and marked as internal

#### Scenarios

##### User adds an internal note

###### Steps
* Act: Click the "New Ticket" button
* Act: Type "Complex issue" into the subject input field
* Act: Click the "Submit" button
* Act: Click on the ticket "Complex issue"
* Act: Click the "Add Internal Note" button
* Act: Type "Escalating to engineering team" into the note input field
* Act: Click the "Save" button
* Check: The text "Escalating to engineering team" is visible on the page

---

### Search Tickets

Users can search for tickets by subject or content.

#### Dependencies
1. Sign Up: User creates a new account
2. Create Ticket: User creates a ticket

#### Rules

##### Results Found
- When:
  - User types in search field
- Then:
  - Matching tickets are displayed

#### Scenarios

##### User searches for a ticket

###### Steps
* Act: Click the "New Ticket" button
* Act: Type "Payment processing error" into the subject input field
* Act: Click the "Submit" button
* Act: Type "payment" into the search input field
* Check: The text "Payment processing error" is visible on the page
