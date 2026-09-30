# Changelog

## 0.1.7

- On Error works for Stop Workflow, Continue, and Continue using the error output.
- Stop Workflow keeps the Origami HTTP status and description instead of wrapping the API error in a second error.
- Continue items include error, description, httpCode (HTTP errors only), origamiError, resource, operation, itemIndex and the paired item.
- A failed dropdown or request surfaces as a readable API error instead of a raw client exception.
