# Interrupt Sounds Folder

Place your "interrupt acknowledgment" sound effect files here.

## Files Expected

Add MP3 files with names like:
- `int1.mp3`
- `int2.mp3`
- `int3.mp3`

## Usage

These sounds play to the caller immediately when:
1. They interrupt the AI (start speaking while AI is talking)
2. Soniox detects their speech (partial transcript)
3. AI audio buffer is cleared

This creates an acknowledgment that their interruption was heard.

## Sound Suggestions

Good interrupt sounds:
- Quick acknowledgment (e.g., "mm-hmm", "uh-huh")
- Brief confirmation sound
- Short (0.2-0.5 seconds)
- Non-intrusive

## Configuration

Edit `interruptSounds` object in `index.html`:
```javascript
const interruptSounds = {
  folder: '/interrupt',
  files: ['int1.mp3', 'int2.mp3', 'int3.mp3'],
  enabled: true
};
```

