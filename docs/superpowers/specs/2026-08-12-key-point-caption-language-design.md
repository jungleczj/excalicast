# Key Point Caption Language Design

## Goal

Generated key point motion must use the dominant language of the complete subtitle track. The export page locale controls interface copy only and must not control generated content.

## Language Resolution

- Count Han characters and Latin-script words across all non-empty subtitle cues.
- Resolve Chinese when Han characters are the dominant meaningful signal; otherwise resolve English.
- For mixed subtitles, use one dominant language for the complete generated track so adjacent cards do not switch languages.
- Empty or non-linguistic input falls back to the caller hint, then Chinese.

## Data Flow

- The export page resolves the subtitle language once for task metadata, the DeepSeek request, and local fallback generation.
- The API independently resolves language from its validated cues. A client-provided locale is only a fallback hint and cannot override detectable subtitle content.
- Prompt construction and response validation use the resolved subtitle language, ensuring DeepSeek output and accepted phrases follow the same contract.

## Validation

- English UI with Chinese subtitles produces Chinese key points.
- Chinese UI with English subtitles produces English key points.
- Mixed subtitles use the dominant language consistently.
- Local fallback follows the same resolved language as the remote generation path.
