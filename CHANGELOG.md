# Changelog

## 0.1.9

- Package metadata only: the author contact email is now a reachable address. No code changes.

## 0.1.8

- Test connection now runs from the credential itself. It still reports a wrong username or API secret as an error, even though Origami answers those with HTTP 200.
- File upload signs in through the saved Origami credential like every other operation. The file keeps its name and type, and upload errors are reported as before.
- Passes the n8n community package scanner used for verified nodes.

## 0.1.7

- On Error works for Stop Workflow, Continue, and Continue using the error output.
- Stop Workflow keeps the Origami HTTP status and description instead of wrapping the API error in a second error.
- Continue items include error, description, httpCode (HTTP errors only), origamiError, resource, operation, itemIndex and the paired item.
- A failed dropdown or request surfaces as a readable API error instead of a raw client exception.
