#!/usr/bin/env bun
/**
 * Diagnostic script to check sync state for all folders
 * Useful for troubleshooting sync issues and verifying system health
 */

import { getAccounts, getFolders, getMailboxState, getLatestMessageUid } from "../lib/db";

async function diagnoseSyncState() {
  console.log("=== Noctua Mail Sync State Diagnostic ===\n");

  const accounts = await getAccounts();

  if (accounts.length === 0) {
    console.log("❌ No accounts found");
    return;
  }

  for (const account of accounts) {
    console.log(`📧 Account: ${account.name} (${account.email})`);
    console.log(`   Account ID: ${account.id}\n`);

    const folders = await getFolders(account.id);
    const inboxFolder = folders.find(
      f => f.specialUse?.toLowerCase() === "\\inbox" || f.name.toLowerCase() === "inbox"
    );

    if (!inboxFolder) {
      console.log("  ⚠️  No INBOX folder found");
      continue;
    }

    console.log(`  📁 INBOX Folder ID: ${inboxFolder.id}`);
    console.log(`     Name: ${inboxFolder.name}`);

    // Extract mailbox path from folder ID (format: accountId:mailboxPath)
    const mailboxPath = inboxFolder.id.split(':').slice(1).join(':');
    console.log(`     Path: ${mailboxPath}`);

    // Check mailbox state
    const mailboxState = await getMailboxState(account.id, inboxFolder.id);
    console.log(`\n  💾 Mailbox State:`);
    console.log(`     highestUid: ${mailboxState?.highestUid ?? "null"}`);
    console.log(`     uidValidity: ${mailboxState?.uidValidity ?? "null"}`);
    console.log(`     highestModSeq: ${mailboxState?.highestModSeq ?? "null"}`);

    // Check latest message UID in database
    const latestUid = await getLatestMessageUid(account.id, mailboxPath);
    console.log(`\n  📨 Latest Message UID in DB: ${latestUid ?? "null"}`);

    // Calculate what the next sync would do
    const highestKnownUid = mailboxState?.highestUid ?? latestUid ?? null;
    console.log(`\n  🔍 Sync Decision Logic:`);
    console.log(`     highestKnownUid (max of mailboxState.highestUid and latestUid): ${highestKnownUid ?? "null"}`);

    if (highestKnownUid !== null) {
      const nextStartUid = highestKnownUid + 1;
      console.log(`     Next "new" sync would fetch UIDs >= ${nextStartUid}`);
      console.log(`     (Any message with UID >= ${nextStartUid} would be fetched)`);
    } else {
      console.log(`     No baseline - would sync recent messages`);
    }

    console.log(`\n  ⚙️  What happens during "new" sync:`);
    console.log(`     1. Checks IMAP server's uidNext value for INBOX`);
    console.log(`     2. If uidNext <= ${(highestKnownUid ?? 0) + 1}, sync is SKIPPED`);
    console.log(`     3. If uidNext > ${(highestKnownUid ?? 0) + 1}, fetches new messages`);

    // Check sync settings
    const pollInterval = account.settings?.sync?.pollIntervalMs ?? 300000;
    const backgroundPollInterval = account.settings?.sync?.backgroundPollIntervalMs;
    console.log(`\n  ⏱️  Sync Settings:`);
    console.log(`     Poll interval: ${pollInterval}ms (${Math.round(pollInterval / 1000)}s)`);
    if (backgroundPollInterval) {
      console.log(`     Background poll interval: ${backgroundPollInterval}ms (${Math.round(backgroundPollInterval / 1000)}s)`);
    }
    console.log(`     Max idle sessions: ${account.settings?.sync?.maxIdleSessions ?? 3}`);

    console.log("\n" + "=".repeat(70) + "\n");
  }

  console.log("💡 Troubleshooting Steps:");
  console.log("\n1. Check if new mail is being detected:");
  console.log("   - Open browser console (F12) and click the Sync button");
  console.log("   - Look for sync-related logs or errors");
  console.log("   - Check the Network tab for requests to /api/sync/new-candidates");
  console.log("");
  console.log("2. Verify IMAP server state:");
  console.log("   - The 'highestKnownUid' value above is what we think is the last message");
  console.log("   - If your IMAP server's uidNext is the same or lower, no sync will happen");
  console.log("   - This can happen if Thunderbird is using a different IMAP folder");
  console.log("");
  console.log("3. Force a full sync:");
  console.log("   - Use a full sync to re-fetch all messages");
  console.log("   - Check if there's a context menu or option for full sync");
  console.log("");
  console.log("4. Check polling interval:");
  console.log("   - Default is 5 minutes (300000ms) which is quite long");
  console.log("   - You can adjust this in account settings if available");
  console.log("");
  console.log("5. Check for sync errors:");
  console.log("   - Look in browser console for IMAP connection errors");
  console.log("   - Verify IMAP credentials are still valid");
  console.log("");
}

diagnoseSyncState().catch(console.error);
