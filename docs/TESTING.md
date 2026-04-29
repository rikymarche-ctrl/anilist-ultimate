# Anilist Ultimate - Testing Guide

## 📦 Build Status

✅ **Build Successful**

- Time: 1.54s
- Modules: 156
- Bundle Size: ~205 KB total

### Bundle Breakdown:

| File               | Size     | Gzipped  |
| ------------------ | -------- | -------- |
| CalendarModule.js  | 90.17 kB | 24.29 kB |
| main.ts.js         | 8.25 kB  | 3.22 kB  |
| calendar.css       | 10.16 kB | 1.97 kB  |
| settings-panel.css | 5.97 kB  | 1.35 kB  |
| main.css           | 2.93 kB  | 0.92 kB  |

---

## 🚀 Installation Steps

### 1. Load Extension in Chrome

```bash
1. Open Chrome (or Edge/Brave)
2. Navigate to: chrome://extensions/
3. Enable "Developer mode" (toggle in top-right)
4. Click "Load unpacked"
5. Select folder: C:\Users\ricca\Documenti\Anilist\anilist-ultimate\dist
```

### 2. Verify Installation

You should see:

- ✅ "Anilist Ultimate" extension listed
- ✅ Version: 2.0.0
- ✅ No errors in the extension card

---

## 🧪 Test Checklist

### Phase 1: Basic Loading

- [ ] **Extension Loads**

  - Open Chrome DevTools (F12)
  - Go to Console tab
  - Navigate to: https://anilist.co/home
  - Look for: `[Anilist Ultimate] ✓ v2.0.0 loaded successfully!`
- [ ] **Check Global Object**

  - In Console, type: `AnilistUltimate`
  - Should show object with `version`, `log`, `storage`

### Phase 2: Calendar Module

- [ ] **Calendar Replaces Airing Section**

  - Navigate to: https://anilist.co/home
  - Scroll to where "Airing" section was
  - Should see: "Weekly Schedule" header
  - Should see: Day columns (Mon, Tue, Wed, etc.)
- [ ] **Data Loading**

  - Check Console for: `Calendar module initialized successfully`
  - Check Console for: `Fetched X anime entries`
  - Verify anime cards are visible
- [ ] **Anime Cards Display**

  - Each card should show:
    - Cover image
    - Anime title
    - Episode number
    - Airing time/countdown
    - ✓ button (on hover)

### Phase 3: Interactions

- [ ] **Click Anime Card**

  - Click any anime card
  - Should open Anilist anime page in new tab
- [ ] **Mark as Watched**

  - Hover over an anime card
  - Click the ✓ button
  - Button should show spinner
  - Check Console for: `Episode marked as watched`
  - Card should fade out or update progress
- [ ] **Refresh Button**

  - Click refresh icon in calendar header
  - Calendar should reload data
  - Check Console for: `Refreshing calendar data`

### Phase 4: Settings Panel

- [ ] **Open Settings**

  - Click settings (⚙️) icon in calendar header
  - Settings modal should appear
  - Modal should have dark overlay
- [ ] **Settings Options Visible**

  - Layout Mode dropdown (Standard/Compact/Extended)
  - Display toggles (Show Time, Episode Numbers, etc.)
  - Week options (Start Day, Max Cards)
- [ ] **Change Layout Mode**

  - Select "Compact" from Layout Mode
  - Calendar should instantly update to compact view
  - Cards should be smaller, horizontal layout
- [ ] **Toggle Settings**

  - Toggle "Hide Empty Days" on
  - Days with no anime should disappear
  - Toggle back off, they should reappear
- [ ] **Close Settings**

  - Click X button → Should close
  - Click outside modal → Should close
  - Press ESC key → Should close

### Phase 5: Responsive Design

- [ ] **Resize Browser**

  - Make browser window narrow (< 768px)
  - Calendar should adapt to mobile layout
  - Cards should stack vertically
- [ ] **Mobile View**

  - Open Chrome DevTools (F12)
  - Click device toolbar (Ctrl+Shift+M)
  - Select "iPhone 12 Pro"
  - Calendar should be fully functional

### Phase 6: Error Handling

- [ ] **Not Logged In**

  - Open incognito window
  - Go to anilist.co (not logged in)
  - Should see: "Authentication Required" message
  - Should have "Log In" button
- [ ] **Network Error**

  - Open DevTools → Network tab
  - Click "Offline" checkbox
  - Refresh calendar
  - Should see error message with "Retry" button

---

## 🐛 Known Issues / Expected Behavior

### Authentication

- **Issue**: Calendar requires Anilist login
- **Expected**: Auth prompt shown if not logged in
- **Fix**: Log in to Anilist first

### First Load

- **Issue**: May take 2-3 seconds to replace Airing section
- **Expected**: Slight delay while DOM loads
- **Normal**: See loading state briefly

### GraphQL Rate Limit

- **Issue**: Max 90 requests per minute
- **Expected**: Automatic queuing of requests
- **Normal**: Slight delays if many requests

---

## 📊 Debug Commands

Open Console and try these:

```javascript
// Check version
AnilistUltimate.version

// Check store state
AnilistUltimate.calendarStore.getState()

// Check preferences
AnilistUltimate.calendarStore.getState().preferences

// Check entries
AnilistUltimate.calendarStore.getState().entries

// Enable debug logging (if disabled)
AnilistUltimate.log.enable()

// Check API client status
AnilistUltimate.anilistClient.isAuthenticated()
AnilistUltimate.anilistClient.getQueueStatus()
```

---

## ✅ Success Criteria

Extension is working correctly if:

1. ✅ Extension loads without console errors
2. ✅ Calendar replaces Airing section on home page
3. ✅ Anime cards display with cover images
4. ✅ Cards are clickable and open anime pages
5. ✅ Mark watched button works
6. ✅ Settings panel opens and saves preferences
7. ✅ Layout changes apply in real-time
8. ✅ No TypeScript errors in console
9. ✅ Responsive on mobile devices
10. ✅ Auth prompt shows when not logged in

---

## 🔧 Troubleshooting

### Calendar Not Showing

**Symptoms**: Airing section still shows, no calendar

**Solutions**:

1. Check Console for errors
2. Verify you're on https://anilist.co/home
3. Hard refresh (Ctrl+Shift+R)
4. Check if logged in to Anilist
5. Disable other Anilist extensions

### No Anime Cards

**Symptoms**: Calendar shows but no anime

**Solutions**:

1. Verify you have "Watching" anime on Anilist
2. Check those anime have upcoming episodes
3. Check Console for API errors
4. Try refresh button
5. Check network tab for failed requests

### Settings Not Saving

**Symptoms**: Settings reset on page reload

**Solutions**:

1. Check Chrome storage permissions
2. Open chrome://extensions/ → Details → Check permissions
3. Clear extension storage and reload
4. Check Console for storage errors

### Images Not Loading

**Symptoms**: Broken image icons

**Solutions**:

1. Check internet connection
2. Check Anilist CDN is accessible
3. Hard refresh (Ctrl+Shift+R)
4. Check Console for CORS errors

---

## 📝 Test Results Template

```
Date: ___________
Tester: ___________
Browser: Chrome / Edge / Brave
Version: ___________

✅ / ❌  Extension loads
✅ / ❌  Calendar displays
✅ / ❌  Cards clickable
✅ / ❌  Mark watched works
✅ / ❌  Settings functional
✅ / ❌  Responsive design
✅ / ❌  No console errors

Notes:
_________________________________
_________________________________
```

---

## 🎯 Next Steps After Testing

If all tests pass:

- ✅ Extension is production-ready
- ✅ Can start Phase 3: Additional modules
- ✅ Can publish to Chrome Web Store (optional)

If tests fail:

- 📋 Document specific failures
- 🐛 Create issue list
- 🔧 Prioritize fixes
- 🔄 Re-test after fixes

---

**Happy Testing! 🚀**
