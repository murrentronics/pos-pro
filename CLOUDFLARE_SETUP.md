# Cloudflare Pages Setup Guide

## Your Deployment URL
https://pospro-web.pages.dev

## Step 1: Set Environment Variables in Cloudflare Pages

Go to your Cloudflare Pages dashboard:
1. Go to https://dash.cloudflare.com
2. Click on **Pages** in the left sidebar
3. Click on your **pospro-web** project
4. Go to **Settings** → **Environment variables**
5. Add these variables for **Production**:

```
VITE_SUPABASE_URL = https://wpuqdwrndjswjzieoinx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndwdXFkd3JuZGpzd2p6aWVvaW54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5MzgzMzYsImV4cCI6MjEwMTUxNDMzNn0.d-uguw1p2gUgqjxf_WhZSvXwQD6AbB-A2pIIZah7nFc
```

6. Click **Save**
7. Go to **Deployments** tab
8. Click **Retry deployment** on the latest deployment

## Step 2: Configure Supabase URL Allowlist

Go to your Supabase dashboard:
1. Go to https://supabase.com/dashboard
2. Select your project: **wpuqdwrndjswjzieoinx**
3. Go to **Authentication** → **URL Configuration**
4. Add these URLs to **Redirect URLs**:
   - `https://pospro-web.pages.dev`
   - `https://pospro-web.pages.dev/login`
   - `https://pospro-web.pages.dev/*`
5. Add to **Site URL**: `https://pospro-web.pages.dev`
6. Click **Save**

## Step 3: Build Settings (if needed)

Make sure your Cloudflare Pages build settings are:
- **Build command**: `npm run build`
- **Build output directory**: `dist/client`
- **Root directory**: `/` (leave empty)
- **Node version**: 18 or higher

## Step 4: Test the Deployment

After redeploying:
1. Visit https://pospro-web.pages.dev
2. Try to login with your admin credentials
3. Check browser console (F12) for any errors

## Troubleshooting

### If you see "Missing Supabase environment variables":
- Make sure you added the environment variables in Cloudflare Pages
- Redeploy after adding them

### If login doesn't work:
- Check that you added the URLs to Supabase redirect allowlist
- Clear browser cache and try again

### If you see a blank page:
- Check browser console for errors
- Make sure build output directory is set to `dist/client`

## Quick Deploy Command

To redeploy from your local machine:
```bash
npm run build
npx wrangler pages deploy dist/client --project-name=pospro-web
```
