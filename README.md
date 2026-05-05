# Conversational CLI Agent — Scaler Website Clone

A terminal-based AI agent (inspired by Cursor/Windsurf) that understands natural language, reasons step-by-step, and generates real working code.


## Overview

This project implements a **conversational CLI agent** that:

- Runs directly in the terminal
- Accepts natural language instructions from the user
- Uses an LLM + tool system to **reason, act, and iterate**
- Generates **real files on disk**
- Produces a **fully working website clone**

The primary task:
> Clone the Scaler Academy website and generate a visually similar webpage with Header, Hero Section, and Footer.

## Features

### Conversational CLI Interface
- Interactive terminal chat using `readline`
- Continuous conversation loop (agent doesn’t stop after one response)

### Autonomous Agent Behavior
- Plans → Executes → Observes → Iterates
- Uses tools to take real actions (not just text output)

### Tooling System
The agent can:

- `scrape_website` → Extract real HTML, CSS, JS from target site  
- `write_file` → Create actual project files  
- `read_file` → Read existing files  
- `open_browser` → Open output in browser  

### Website Cloning Capability
- Generates:
  - `index.html`
  - `styles.css`
  - `script.js`
- Includes:
  - Header (navigation)
  - Hero section
  - Footer
- Produces a **browser-ready UI**

### Iterative Execution (Key Requirement)
- The agent **does NOT complete everything in one step**
- It loops through:
  - Thinking
  - Tool calling
  - File creation
  - Refinement


## Setup & Installation

### 1. Clone the Repository

``` 
git clone <your-repo-link
cd <repo-name>
``` 

### 2. Install Dependencies

``` 
npm install
``` 

### 3. Add Environment Variables

Create a .env file:
``` 
OPENROUTER_API_KEY=your_api_key_here
``` 

Running the CLI Agent

``` 
node index.js
``` 
You will see:
``` 
Conversational CLI Agent started. Type 'exit' to quit.
``` 


## Example Usage

```
You: Clone https://www.scaler.com
``` 

What happens internally:
 - Agent scrapes the website
 - Extracts design + structure
 - Writes HTML file
 - Writes CSS file
 - Writes JS file
 - Opens the result in your browser

How It Works
1. Conversation Loop

- The agent continuously:
    - Takes user input
    - Sends it to the LLM
    - Receives responses + tool calls
2. Tool Execution Layer
    - if (name === "write_file") { ... }
    - if (name === "scrape_website") { ... }
3. Website Scraping
    - Fetches HTML
    - Extracts CSS + JS files
    - Cleans structure
    - Sends structured data back to agent
4. Iterative Generation

The agent:
- Does NOT generate everything at once
- Writes files step-by-step
- Ensures correctness before proceeding