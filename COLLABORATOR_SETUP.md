# Passport Collaborator Feature - Setup Guide

## Overview
This feature allows passport owners to add collaborators who can view and edit the passport sections, tasks, and questions.

## Changes Made

### 1. Database Schema (Prisma)
- Added `PassportCollaborator` model to track passport collaborations
- Updated `User` model to include `passportCollaborations` relation
- Updated `Passport` model to include `collaborators` relation

### 2. Backend API Endpoints

#### Add Collaborator
```
POST /passport/:id/collaborators
Authorization: Bearer <token>
Body: { "email": "collaborator@example.com" }
```

#### Get Collaborators
```
GET /passport/:id/collaborators
Authorization: Bearer <token>
```

#### Remove Collaborator
```
POST /passport/:id/collaborators/:collaboratorId/remove
Authorization: Bearer <token>
```

### 3. Authorization Updates
- Updated all passport, task, and question endpoints to check for both owner and collaborator access
- Only the owner can add or remove collaborators

## Setup Instructions

### Step 1: Run Database Migration

Open a terminal in the backend directory and run:

```bash
cd d:\ReactProjects\op_nuxt\umu-backend

# Generate Prisma client with new schema
npx prisma generate

# Create and apply migration
npx prisma migrate dev --name add-passport-collaborators
```

This will:
1. Generate the updated Prisma client with the new `PassportCollaborator` model
2. Create a new migration file
3. Apply the migration to your database

### Step 2: Restart the Backend Server

After running the migration, restart your NestJS backend:

```bash
# Stop the current server (Ctrl+C)
# Then start it again
npm run start:dev
```

## Testing the Collaborator Feature

### Using API Console or Postman

#### 1. Get User Tokens

First, you need tokens for two different users (owner and collaborator).

**Login as User 1 (Owner):**
```bash
POST http://localhost:3000/auth/login
Content-Type: application/json

{
  "email": "owner@example.com",
  "password": "password123"
}
```

Save the token as `OWNER_TOKEN`.

**Login as User 2 (Collaborator):**
```bash
POST http://localhost:3000/auth/login
Content-Type: application/json

{
  "email": "collaborator@example.com",
  "password": "password123"
}
```

Save the token as `COLLABORATOR_TOKEN`.

#### 2. Create a Passport (as Owner)

```bash
POST http://localhost:3000/passport/create
Authorization: Bearer <OWNER_TOKEN>
Content-Type: application/json

{
  "addressLine1": "123 Test Street",
  "postcode": "AB12 3CD"
}
```

Save the `passportId` from the response.

#### 3. Try to Access as Collaborator (Should Fail)

```bash
GET http://localhost:3000/passport/<passportId>/sections
Authorization: Bearer <COLLABORATOR_TOKEN>
```

Expected: 403 Forbidden - "You do not have access to this passport"

#### 4. Add Collaborator (as Owner)

```bash
POST http://localhost:3000/passport/<passportId>/collaborators
Authorization: Bearer <OWNER_TOKEN>
Content-Type: application/json

{
  "email": "collaborator@example.com"
}
```

Expected: Success response with collaborator details.

#### 5. Try to Access as Collaborator Again (Should Succeed)

```bash
GET http://localhost:3000/passport/<passportId>/sections
Authorization: Bearer <COLLABORATOR_TOKEN>
```

Expected: 200 OK with sections data.

#### 6. Get List of Collaborators

```bash
GET http://localhost:3000/passport/<passportId>/collaborators
Authorization: Bearer <OWNER_TOKEN>
```

Expected: Array of collaborators.

#### 7. Remove Collaborator

First, get the `collaboratorId` from the list, then:

```bash
POST http://localhost:3000/passport/<passportId>/collaborators/<collaboratorId>/remove
Authorization: Bearer <OWNER_TOKEN>
```

Expected: Success message.

### Using cURL

**Add Collaborator:**
```bash
curl -X POST http://localhost:3000/passport/<passportId>/collaborators \
  -H "Authorization: Bearer <OWNER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"email":"collaborator@example.com"}'
```

**Get Collaborators:**
```bash
curl -X GET http://localhost:3000/passport/<passportId>/collaborators \
  -H "Authorization: Bearer <OWNER_TOKEN>"
```

**Remove Collaborator:**
```bash
curl -X POST http://localhost:3000/passport/<passportId>/collaborators/<collaboratorId>/remove \
  -H "Authorization: Bearer <OWNER_TOKEN>"
```

## Error Cases

### User Not Found
```json
{
  "statusCode": 403,
  "message": "User with this email not found"
}
```

### Only Owner Can Add Collaborators
```json
{
  "statusCode": 403,
  "message": "Only the owner can add collaborators"
}
```

### Already a Collaborator
```json
{
  "statusCode": 403,
  "message": "User is already a collaborator"
}
```

### User is Already Owner
```json
{
  "statusCode": 403,
  "message": "User is already the owner"
}
```

## Frontend Integration (Future)

The UI already has a placeholder for adding collaborators in the passport view page. To integrate:

1. Create a composable `usePassportCollaborators.ts`:

```typescript
export const usePassportCollaborators = () => {
  const config = useRuntimeConfig()
  const base = config.public.apiBase

  const getHeaders = () => {
    const token = localStorage.getItem('token')
    return { Authorization: `Bearer ${token}` }
  }

  const addCollaborator = (passportId: string, email: string) => {
    return $fetch(`${base}/passport/${passportId}/collaborators`, {
      method: 'POST',
      headers: getHeaders(),
      body: { email },
    })
  }

  const getCollaborators = (passportId: string) => {
    return $fetch(`${base}/passport/${passportId}/collaborators`, {
      headers: getHeaders(),
    })
  }

  const removeCollaborator = (passportId: string, collaboratorId: string) => {
    return $fetch(`${base}/passport/${passportId}/collaborators/${collaboratorId}/remove`, {
      method: 'POST',
      headers: getHeaders(),
    })
  }

  return {
    addCollaborator,
    getCollaborators,
    removeCollaborator,
  }
}
```

2. Update the passport view page to use this composable for adding/removing collaborators.

## Notes

- Only the passport owner can add or remove collaborators
- Collaborators have full read/write access to the passport (same as owner, except they can't add/remove other collaborators)
- When a collaborator is removed, they immediately lose access to the passport
- The `@@unique([passportId, userId])` constraint ensures a user can only be added as a collaborator once per passport
