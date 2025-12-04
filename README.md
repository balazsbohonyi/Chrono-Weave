# ChronoWeave

An interactive historical timeline visualization platform powered by AI. Explore centuries of history through an intuitive canvas-based interface, discovering relationships between historical figures and events, and diving deep into the stories that shaped civilization.

## About ChronoWeave

ChronoWeave transforms the study of history into an immersive, visual experience. Rather than reading linear timelines, you can:
- **Visualize** historical figures and events across centuries in an interactive 2D canvas
- **Explore** relationships and connections between people who shaped history
- **Discover** new figures and events through contextual expansion
- **Learn** detailed biographies, famous quotes, and historical context powered by AI

The app leverages Google Gemini or OpenRouter APIs to intelligently generate historical data and analyze connections between figures, making history discovery feel like an interactive journey through time.

## Key Features

### 🎨 Interactive Timeline Canvas
- Visualize historical figures and events as bars on a horizontal timeline
- Zoom and pan the canvas for detailed exploration
- Color-coded by category (Artists, Scientists, Leaders, Writers, etc.)
- Click on years to see all figures active during that period
- Hover over figures to reveal action options

### 🔗 Relationship Mapping
- **Map Relationships**: Click "Map Relationships" to visualize connections between a figure and related historical figures
- **Visual Connection Lines**: Relationship bars show AI-identified connections, with visual lines connecting related figures
- **Detailed Explanations**: Click on a relationship to read an AI-generated explanation of how two figures were connected
- **Smart Analysis**: AI identifies relationships based on contemporary periods, influence, and historical significance

### 🔍 Contextual Discovery
- **Expand Timeline**: Click "Expand Timeline" on any figure to discover new related historical figures not in the current view
- **Intelligent Addition**: Newly discovered figures are seamlessly added to the timeline with preserved visual layout
- **Visual Highlighting**: Newly discovered figures are visually distinguished from existing ones
- **Automatic Relationships**: New figures are automatically connected to the source figure with relationship visualization

### 📖 Deep Dive Biographies
- **Read Biography**: Click to view detailed AI-generated biographical information
- **Famous Quotes**: Discover iconic quotes from historical figures
- **Sectioned Content**: Information organized into meaningful categories (achievements, legacy, historical context, etc.)
- **Wikipedia Integration**: Enriched with images and descriptions from Wikipedia
- **Lazy Loading**: Details are fetched on-demand, keeping the app fast

### 🏷️ Category Filtering & Legend
- **8 Figure Categories**: Artists, Business, Entertainers, Explorers, Leaders & Baddies, Scientists, Thinkers, Writers
- **Historical Events**: Separate category for major historical events (wars, treaties, movements)
- **Visual Legend**: Toggle categories on/off to focus on specific disciplines
- **Color Coding**: Each category has a distinct color for easy identification
- **Bulk Filtering**: Reset all filters or select multiple categories at once

### 🔎 Figure Search & Navigation
- **Real-time Search**: Type figure names to instantly highlight matching results
- **Search Navigation**: Navigate through search results with next/previous buttons
- **Result Counter**: See how many figures match your search
- **Search Focus**: Automatically highlights and focuses on search results

### ⚙️ Flexible AI Backend
- **Provider Selection**: Switch between Google Gemini and OpenRouter API
- **OpenRouter Support**: Use any OpenRouter-compatible model (Claude, Llama, etc.)
- **Easy Configuration**: Settings dialog to manage API keys and model selection
- **Persistent Settings**: Your provider and model preferences are saved locally

### 📱 Responsive Interface
- **Collapsible Sidebar**: Shows figures active in selected year or global figure list
- **Figure Details Panel**: View full descriptions, images, and occupation details
- **Toast Notifications**: Real-time feedback on discoveries, searches, and actions
- **Progress Overlays**: Clear loading states during data fetching and analysis

### 🌍 Figure & Event Management
- **Custom Year Ranges**: Build timelines for any historical period
- **Alphabetically Sorted Lists**: Sidebar figures and events sorted alphabetically by name
- **Preserved Scroll Position**: Separate scroll tracking for figures and events—switch between tabs and your scroll position is remembered
- **Dual View Mode**: Toggle between figures and events in the sidebar
- **Category-aware Filtering**: Sidebar respects active category filters

## Installation & Setup

**Prerequisites:** Node.js

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set the `PROVIDER`, `API_KEY`, and optionally `MODEL` in [.env.local](.env.local) to configure the AI backend:
```bash
PROVIDER=gemini
API_KEY=your_api_key_here
# Optional: specify model, defaults to gemini-2.5-flash for Gemini or appropriate model for OpenRouter
MODEL=gemini-2.5-flash
```

More explanations in the [.env.example](.env.example)

3. Run the development server:
   ```bash
   npm run dev
   ```

The app will be available at `http://localhost:3000`

### Optional: Use OpenRouter

Instead of Gemini, you can use OpenRouter API:

1. Open the app and click the settings gear icon
2. Select "OpenRouter" as the provider
3. Enter your OpenRouter API key
4. Choose your preferred model (e.g., Claude 3.5 Sonnet)
5. Click Save to apply changes

## Available Commands

```bash
# Development server with hot reload
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview
```

## Technology Stack

- **Frontend**: React 19 with TypeScript
- **Bundler**: Vite 6
- **AI APIs**: Google Gemini & OpenRouter
- **Styling**: Tailwind CSS
- **Canvas Rendering**: HTML5 Canvas with custom layout algorithm
