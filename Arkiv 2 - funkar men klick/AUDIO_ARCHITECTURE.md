# Audio Architecture Problem

## Current Setup (BROKEN)

```
You (Microphone) ──────────────────► Verto ──► Remote Party
                                        │
                                        ▼
                                    Remote Audio
                                        │
                                        ▼
                                   [Audio Bridge]
                                        │
                                        ▼
                                  ElevenLabs AI
                                        │
                                        ▼
                                   Local Speakers
```

**Problems:**
1. AI hears the REMOTE PARTY, not YOU
2. Remote party doesn't hear AI responses
3. AI hangs up after 20 seconds because it hears nothing useful

## What You Probably Want (Option A: AI Between You and Remote Party)

```
You (Microphone) ──► ElevenLabs AI ──► Verto ──► Remote Party
                           │
                           ▼
                     Local Speakers

Remote Party ──► Verto ──► ElevenLabs AI ──► You (Speakers)
```

**Behavior:**
- You talk → AI hears you → AI responds → Remote party hears AI
- Remote party talks → AI hears them → AI responds → You hear AI
- AI acts as middleman in conversation

## Option B: AI Listens to You Only

```
You (Microphone) ──┬──► Verto ──► Remote Party
                   │
                   └──► ElevenLabs AI ──► Local Speakers

Remote Party ──► Verto ──► You (Speakers)
```

**Behavior:**
- You talk → Both Verto AND AI hear you
- AI responds → You hear it locally (remote party doesn't)
- Remote party talks → You hear them (AI doesn't)
- AI is your personal assistant, not part of the call

## Option C: AI Listens to Remote Party

```
You (Microphone) ──► Verto ──► Remote Party

Remote Party ──► Verto ──┬──► You (Speakers)
                         └──► ElevenLabs AI ──► Local Speakers
```

**Behavior:**
- You talk → Remote party hears you (AI doesn't)
- Remote party talks → Both You AND AI hear them
- AI responds → You hear it locally (for note-taking/assistance)
- AI analyzes what remote party says

## Implementation Changes Needed

### For Option A (Full Bridge):
1. Get microphone stream separately
2. Route microphone → AI → Verto outgoing
3. Route Verto incoming → AI → You
4. Complex mixing required

### For Option B (AI Assistant):
1. Get microphone stream separately
2. Send mic audio to BOTH Verto AND AI
3. AI responses play locally only
4. Simpler to implement

### For Option C (Current, but fixed):
1. Keep current approach
2. Just fix audio format/connection issues
3. AI only hears remote party

## Recommended Approach

**Start with Option B** as it's simplest and most useful:
- AI hears what YOU say
- AI can provide real-time assistance
- No complex audio mixing
- Remote party not aware of AI

Then optionally upgrade to Option A if you want AI to participate in the call.

## Technical Challenges

1. **ScriptProcessorNode is deprecated** - should use AudioWorklet
2. **No direct access to Verto's outgoing stream** - makes injection hard
3. **Audio format conversion** - PCM 16-bit @ 48kHz
4. **Latency** - need to minimize processing delay
5. **Echo cancellation** - if AI audio feeds back into mic

## Next Steps

Choose which option you want and I'll implement it properly.

