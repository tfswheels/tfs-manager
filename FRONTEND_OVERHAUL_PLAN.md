# Frontend Overhaul Plan

## Issues to Fix

### Critical (Breaking UX)
1. **Email dates showing "Unknown date"**
   - Issue: `received_at` and `sent_at` are null
   - Fix: Use `created_at` as fallback

2. **EmailThread using wrong API endpoint**
   - Current: `/api/emails/conversations/:id`
   - Should be: `/api/tickets/:id`

3. **Email content cropping/styling**
   - HTML emails not rendering properly
   - Text overflow and spacing issues

4. **Basic textarea for replies**
   - Need: Gmail-style rich text editor (TipTap)
   - Need: Attachment upload

### High Priority (Poor UX)
5. **Narrow layout wasting screen space**
   - App confined to small width
   - Need full-width responsive design

6. **Poor mobile responsiveness**
   - Not optimized for mobile
   - Need mobile-first approach

7. **Inconsistent styling**
   - Mix of Polaris + custom CSS
   - Need unified design system

## Solution: Comprehensive Frontend Overhaul

### Phase 1: Quick Fixes (1-2 hours)
- [ ] Fix email date display
- [ ] Update EmailThread to use `/api/tickets/:id`
- [ ] Fix email HTML rendering
- [ ] Improve email content styling

### Phase 2: Rich Text Editor (2-3 hours)
- [ ] Install TipTap packages
- [ ] Create RichTextEditor component
- [ ] Add toolbar (bold, italic, lists, links)
- [ ] Integrate with reply functionality
- [ ] Add attachment upload

### Phase 3: Tailwind Integration (3-4 hours)
- [ ] Install Tailwind CSS
- [ ] Configure for Vite
- [ ] Create design system (colors, spacing)
- [ ] Migrate Layout component
- [ ] Migrate SupportTickets component
- [ ] Migrate EmailThread component

### Phase 4: Responsive Design (2-3 hours)
- [ ] Full-width layouts for desktop
- [ ] Mobile-optimized navigation
- [ ] Responsive ticket list
- [ ] Responsive email view
- [ ] Touch-friendly controls

## Total Estimated Time: 8-12 hours

## Approach
1. Start with quick wins (Phase 1)
2. Then add rich editor (Phase 2)
3. Finally, comprehensive Tailwind overhaul (Phase 3 & 4)

## Decision: Start with Phase 1 now?
This will get the app functional immediately, then we can do the bigger overhaul.
