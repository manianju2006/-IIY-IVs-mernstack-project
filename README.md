# Quick Byte

Quick Byte is a campus food ordering app with:
- `frontend/` for static pages, styles, scripts, and assets
- `backend/` for the Express and MongoDB API

## Requirements

Before running the project, install:
- Node.js 18 or newer
- MongoDB Community Server

## Share With A Friend

If you want someone else to run this project on their own device, send the full project folder.

Recommended:
- zip the `Quick_Byte` project folder
- include `frontend/`, `backend/`, `package.json`, `README.md`, and test files
- do not include `backend/node_modules/`, `node_modules/`, `playwright-report/`, or `test-results/`

Your friend should extract the folder, open a terminal in the project root, and follow the setup steps below.

## Setup

1. Install backend dependencies:
   `npm run install:backend`
2. Copy environment variables:
   - copy `backend/.env.example` to `backend/.env`
   - keep the defaults unless a different MongoDB URL, port, or admin login is needed
3. Make sure MongoDB is running locally on the machine.
4. Start the app:
   `npm start`
5. Open:
   `http://localhost:5000`

## Environment

Copy `backend/.env.example` to `backend/.env` and update values if needed.

Default local database:
`mongodb://127.0.0.1:27017/quickbyte`

Default local admin login:
- username: `admin`
- password: `1234`

## Common Issues

If the app does not start:
- make sure MongoDB is running
- make sure dependencies were installed with `npm run install:backend`
- make sure `backend/.env` exists

If port `5000` is already in use:
- change `PORT` in `backend/.env`

## Deploy

This project is deployable as a single Node service because the backend serves the frontend statically.

- Build/install command: `npm run install:backend`
- Start command: `npm start`
- Required env vars:
  - `MONGODB_URI`
  - `PORT` (optional on most platforms)
