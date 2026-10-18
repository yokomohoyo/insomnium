# AI assistant

The AI assistant writes a request from a description, and a commit message from your changes, with a model you choose. It can run entirely on your computer: Insomnium has no AI service of its own, and sends nothing until you ask for a suggestion.

## Set it up

In **Preferences → AI**, enter the base address of an OpenAI-compatible API, the model's name, and a key if the endpoint needs one. **List Models** shows the models the endpoint offers, and **Try the Model** checks that it answers.

| | Endpoint | Key |
|---|---|---|
| [Ollama](https://ollama.com) | `http://localhost:11434/v1` | none |
| [LM Studio](https://lmstudio.ai) | `http://localhost:1234/v1` | none |
| llama.cpp's `llama-server`, vLLM | `http://localhost:8080/v1`, or the port you run it on | none |
| OpenAI | `https://api.openai.com/v1` | yours |
| Anthropic | `https://api.anthropic.com/v1` | yours |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | yours |
| OpenRouter | `https://openrouter.ai/api/v1` | yours |

The key is kept encrypted, like your other saved credentials. Requests to the endpoint go through the proxy set under **General → Network Proxy**.

## A request from a description

With the assistant set up, a collection's **+** menu has **From a Description…**. Describe the request, such as "create an order for two of SKU A-1, as JSON, with my token", and **Create**. The model writes the method, URL, headers and body, and uses the collection's variables (such as `{{ base_url }}`) where they fit. Check the request before you send it.

Sent to the model: your description, and the names of the active environments' variables. Not their values.

## A commit message

In **Git Sync → Commit**, **Suggest a Message** writes a message for the changes you've chosen to commit (or all of them, if none are chosen yet). Edit it as you like before committing.

Sent to the model: the names of the changed requests, folders and environments, and which of their fields changed (with the names of added or removed headers and parameters). Not the values.

## Test a model's API

To try a model's API itself, choose **LLM Request** in a collection's **+** menu. It's an Event Stream request: a streamed chat completion to the AI assistant's endpoint (or Ollama's, when it isn't set up), with a JSON body to edit. The key isn't copied into it, since requests are exported and synced; add it under **Auth** as a Bearer token, from an environment variable such as `{{ api_key }}`.

When a response streams a model's reply, the **LLM** tab puts it together as it arrives, and shows the model, the tokens it used, how long the first token took, the whole reply's time and tokens a second, and why it stopped. It reads OpenAI-compatible chat completions (OpenAI, Ollama, LM Studio, vLLM, OpenRouter and Gemini's), OpenAI's Responses API, and Anthropic's Messages API, with a reasoning model's thinking apart from its reply. To compare models, duplicate the request and change `model`.
