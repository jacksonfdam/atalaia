# Ticket #11: Enhanced Slack Messages

**Status:** TODO
**Verified:** ❌
**Depends On:** #7 (Slack Interactive), #10 (LLM)
**Blocks:** None
**Priority:** MEDIUM

---

## Task Description

Enhance Slack notification messages with Block Kit formatting, client explanations, and interactive buttons.

### What Needs to Be Built

1. **Update `src/infrastructure/notifiers/slackNotifier.js`** with Block Kit format
2. **Include client explanation** in messages
3. **Add @channel tag** for CRITICAL or exploited vulns
4. **Professional formatting** with proper styling

---

## Why This Matters

- **Visibility:** Rich formatting makes vulns stand out
- **Engagement:** Explanations help teams understand urgency
- **Action:** Buttons enable immediate response
- **Alerts:** Critical vulns catch attention immediately

---

## Acceptance Criteria

- [ ] Slack messages use Block Kit format (not plain text)
- [ ] Header shows "🚨 EXPLOITED", "🔴 CRITICAL", or "⚠️ New" emoji
- [ ] Message includes CVE ID, Severity, CVSS score, Affected techs
- [ ] Client explanation prominently displayed
- [ ] Action buttons: "✅ Acknowledge" and "🔒 Resolve"
- [ ] @channel tag only when CRITICAL or exploited
- [ ] Source URL is clickable link in CVE ID field

---

## Implementation Steps

### Step 1: Update Slack Notifier

Update `src/infrastructure/notifiers/slackNotifier.js`:

```javascript
export async function notifySlack(vuln, explanation, webhookUrl) {
  const header = vuln.exploited
    ? '🚨 EXPLOITED VULNERABILITY'
    : vuln.severity === 'CRITICAL'
    ? '🔴 CRITICAL VULNERABILITY'
    : '⚠️ New Vulnerability';

  const message = {
    text: `${vuln.exploited || vuln.severity === 'CRITICAL' ? '@channel ' : ''}${header} - ${vuln.cveId}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: header,
          emoji: true
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*CVE:*\n<${vuln.sourceUrl}|${vuln.cveId}>`
          },
          {
            type: 'mrkdwn',
            text: `*Severity:*\n${vuln.severity} (${vuln.cvssScore})`
          },
          {
            type: 'mrkdwn',
            text: `*Technologies:*\n${vuln.affectedTechnologies.join(', ')}`
          },
          {
            type: 'mrkdwn',
            text: `*Source:*\n${vuln.source}`
          }
        ]
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*What this means:*\n${explanation}`
        }
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Acknowledge' },
            action_id: 'ack_vuln',
            value: vuln.cveId,
            style: 'primary'
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '🔒 Resolve' },
            action_id: 'resolve_vuln',
            value: vuln.cveId,
            style: 'danger'
          }
        ]
      }
    ]
  };

  if (vuln.exploited || vuln.severity === 'CRITICAL') {
    message.blocks[0].text.text += ' 🚨';
  }

  try {
    await axios.post(webhookUrl, message, { timeout: 5000 });
    logger.info({ cveId: vuln.cveId }, 'Slack notification sent');
  } catch (error) {
    logger.error({ cveId: vuln.cveId, error: error.message }, 'Slack notification failed');
  }
}
```

---

## Validation Conditions

### Condition 1: Slack Notifier Updated
```bash
grep -q "blocks:\|mrkdwn" src/infrastructure/notifiers/slackNotifier.js
echo "✅ Slack notifier uses Block Kit"
```

### Condition 2: Client Explanation Included
```bash
grep -q "explanation\|clientExplanation\|What this means" src/infrastructure/notifiers/slackNotifier.js
echo "✅ Explanation included in message"
```

### Condition 3: @channel Tag Present
```bash
grep -q "@channel" src/infrastructure/notifiers/slackNotifier.js
echo "✅ @channel tag implemented"
```

### Condition 4: Buttons Included
```bash
grep -q "ack_vuln\|resolve_vuln\|Acknowledge\|Resolve" src/infrastructure/notifiers/slackNotifier.js
echo "✅ Action buttons included"
```

### Condition 5: Emoji Headers Present
```bash
grep -q "🚨\|🔴\|⚠️" src/infrastructure/notifiers/slackNotifier.js || \
grep -q "EXPLOITED\|CRITICAL\|New" src/infrastructure/notifiers/slackNotifier.js
echo "✅ Emoji headers present"
```

---

## Proof Required

Before marking VERIFIED, provide:

1. **Grep output** confirming Block Kit (Condition 1)
2. **Grep output** confirming explanation (Condition 2)
3. **Grep output** confirming @channel (Condition 3)
4. **Grep output** confirming buttons (Condition 4)
5. **Grep output** confirming emojis (Condition 5)
6. **Manual test** with actual Slack workspace:
   - Send a CRITICAL vuln notification
   - Verify message format and buttons work
7. **Git diff** showing changes

---

## Proof of Verification

_To be filled in after implementation_

```
Condition 1: [✅/❌] Block Kit format
Condition 2: [✅/❌] Explanation included
Condition 3: [✅/❌] @channel tag
Condition 4: [✅/❌] Buttons present
Condition 5: [✅/❌] Emoji headers

Overall Status: TODO → IN_PROGRESS → VERIFIED ✅
Verified At: [timestamp]
Verified By: [name]
```

---

## Notes

- Text fallback for notifications (in case Slack client doesn't support blocks)
- Rich formatting only; no tracking pixel logging
