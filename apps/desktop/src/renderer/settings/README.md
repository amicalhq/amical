# Settings Renderer

This directory contains a standalone settings renderer for the Amical desktop application, modeled after the main renderer structure.

## Structure

```
settings/
├── components/
│   └── settings-sidebar.tsx    # Settings-specific sidebar with navigation
├── pages/
│   ├── general/
│   │   └── index.tsx          # General settings page
│   └── advanced/
│       └── index.tsx          # Advanced settings page
├── content.tsx                # Main content component with routing logic
├── index.tsx                  # Entry point with theme provider and suspense
└── README.md                  # This file
```

## Features

- **Sidebar Navigation**: Dedicated settings sidebar with categories like General, Appearance, Shortcuts, Privacy, Notifications, and Advanced
- **Routing Logic**: State-based routing similar to the main renderer
- **Lazy Loading**: Suspense-based lazy loading for better performance
- **Theme Support**: Integrated with the application's theme provider
- **Demo Pages**: Includes General and Advanced settings pages as examples

## Usage

The settings renderer follows the same pattern as the main renderer:

1. **Entry Point** (`index.tsx`): Sets up the root component with theme provider and suspense
2. **Content Component** (`content.tsx`): Manages navigation state and renders appropriate pages
3. **Sidebar** (`components/settings-sidebar.tsx`): Provides navigation between settings categories
4. **Pages**: Individual setting pages organized by category

## Adding New Pages

To add a new settings page:

1. Create a new directory under `pages/` (e.g., `pages/privacy/`)
2. Add an `index.tsx` file with your page component
3. Import and add the page to the routing logic in `content.tsx`
4. Add the navigation item to the sidebar in `components/settings-sidebar.tsx`

## Navigation State

The settings renderer maintains its own navigation state separate from the main application, stored in localStorage with the key `amical-settings-current-view`.
