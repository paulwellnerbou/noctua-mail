# 🦉 Noctua Mail

A modern, fast web-based mail client built with Bun, TypeScript, and Next.js. Noctua Mail delivers a polished email experience with intelligent threading, powerful search, and seamless IMAP/SMTP support.

![noctua-mail.png](doc/noctua-mail.png)

## ✨ Key Features

### 🔗 Related Mails
Discover connections across your inbox with AI-powered related mail suggestions. When viewing any email, instantly find related messages based on:
- **Subject similarity** – Find conversations on similar topics
- **Sender/Recipient overlap** – Track communications with the same people
- **Thread references** – Follow email chains using In-Reply-To and References headers

Access via the "Show related" option in the message action menu or search with `related:<mail-id>`.

### 🧵 Thread View Across Folders
Unified conversation threading that works **across all folders**. Whether emails are in Inbox, Sent, or any other folder, Noctua Mail intelligently groups them into cohesive threads. Collapse and expand conversations with ease, maintaining context no matter where messages are stored.

### 🔐 IMAP-Only Authentication
Simple, secure authentication using your existing IMAP credentials. No separate user accounts to manage – just connect with your email server credentials and start using Noctua Mail immediately.

---

## 🚀 Features

### 📧 Email Management
- **IMAP sync** – Full folder and message synchronization
- **SMTP support** – Send and reply to emails
- **Multiple accounts** – Manage several email accounts with dedicated settings UI
- **Rich message viewing** – HTML, Text, Markdown, and Source views
- **Attachments** – Inline display and downloadable files
- **Calendar invites** – Display ICS details (full calendar support in progress 📅)

### 🎨 Modern UI
- **Three-pane layout** – Folders, message list, and message view
- **Radix UI components** – Beautiful, accessible interface
- **Dark mode** 🌙 – Easy on the eyes
- **Installable PWA** 📱 – Install as a native app on desktop and mobile
- **OS notifications** 🔔 – Get notified of new emails
- **Responsive design** – Resizable panes with independent scrolling
- **Per-message text scaling** – Adjust font size for individual messages
- **Virtualized lists** ⚡ – Blazing-fast display of thousands of emails

### 🔍 Powerful Search
- **Full-text search** powered by SQLite FTS5
- **Field filtering** – Search by `from:`, `to:`, `subject:`, and more
- **Related mail search** – Find connected conversations with `related:<mail-id>`
- **Search across all folders** – Or narrow down to specific folders

### 💬 Smart Threading
- **Intelligent conversation grouping** – Automatically thread related messages
- **Cross-folder threading** – See complete conversations regardless of folder location
- **Collapse/expand threads** – Focus on what matters
- **Visual thread indicators** – Clear hierarchy and relationships

---

## 🛠️ Tech Stack

- **Runtime** – [Bun](https://bun.sh)
- **Framework** – [Next.js](https://nextjs.org) (App Router)
- **Language** – TypeScript
- **UI** – [Radix UI](https://www.radix-ui.com/themes) + [Lucide Icons](https://lucide.dev)
- **Email** – [ImapFlow](https://imapflow.com) + [Nodemailer](https://nodemailer.com)
- **Database** – SQLite (bun:sqlite) with FTS5 full-text search
- **Rich Text** – [Lexical](https://lexical.dev)

---

## 🏃 Getting Started

### Prerequisites
- [Bun](https://bun.sh) runtime installed

### Installation

```bash
bun install
bun run dev
```

Open [http://localhost:3654](http://localhost:3654) in your browser.

---

## ⚙️ Configuration

### Data Storage
Local data is stored in `.data/` directory:
- SQLite database
- Message sources
- Attachments (stored separately for performance)

### Environment Variables

#### IMAP Credentials Storage
Configure how IMAP/SMTP credentials are stored:

```bash
IMAP_CREDENTIALS_STORAGE=both  # Options: cookie | db | both (default: both)
```

- **`cookie`** – Credentials only in sealed session cookie
- **`db`** – Credentials only in encrypted database
- **`both`** – Credentials in both cookie and encrypted database (recommended)

```bash
IMAP_SECRET_KEY=<32-byte-hex-key>  # Required for DB encryption
```

#### Authentication
Control access to the application:

```bash
AUTH_ENABLED=true  # Default: true - enables login/signup flow
SESSION_SEAL_KEY=<32-byte-hex-key>  # Required for session cookie sealing
```

### Data Directory
Customize the data directory location:

```bash
NOCTUA_DATA_DIR=../noctua-data  # Default: .data/
```

---

## 📁 Project Structure

```
noctua-mail/
├── app/          # Next.js UI and API routes
├── lib/          # Core logic (IMAP/SMTP, storage, search, database)
├── public/       # Static assets
└── .data/        # Local data storage (created on first run)
```

---

## ℹ️ Current Limitations

- **Desktop-optimized** – While installable as a PWA, the UI is currently optimized for desktop/laptop use. Mobile-responsive layout is planned for a future release.

---

## 📄 License

This project is licensed under the [Elastic License 2.0](LICENSE).

**You are free to:**
- ✅ Use, modify, and distribute this software
- ✅ Host it yourself for personal or commercial use

**You may not:**
- ❌ Provide the software to third parties as a managed cloud service (SaaS)

---

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

---

Built with 🦉 by [Paul Wellner Bou](https://wellnerbou.de)
