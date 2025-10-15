# Thinking Sounds Folder

Place your "thinking" sound effect files here.

## Files Expected

Add MP3 files with names like:
- `tic1.mp3`
- `tic2.mp3`
- `tic3.mp3`
- `tic4.mp3`
- `tic5.mp3`

## Usage

These sounds play to the caller immediately when:
1. They finish speaking (Soniox detects endpoint)
2. While waiting for AI to generate response

This creates a natural "thinking" pause indication.

## Configuration

Edit `thinkingSounds` object in `index.html`:
```javascript
const thinkingSounds = {
  folder: '/tic',
  files: ['tic1.mp3', 'tic2.mp3', ...],  // Your sound files
  enabled: true  // Set to false to disable
};
```

## Recommendations

- Keep sounds short (0.3-1 second)
- Use subtle sounds (hmm, uh-huh, thinking noises)
- Multiple variations for naturalness
- Low volume, non-intrusive

