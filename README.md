# n8n-nodes-origami-ms

n8n community node for [Origami.ms](https://origami.ms), the no-code CRM and business platform. Discover your account structure, read and write records, issue invoices, send email/SMS/push, and receive Origami workflow webhooks.

Package name: `n8n-nodes-origami-ms`. It is not related to the unofficial `n8n-nodes-origami` package.

## Installation

Follow the [n8n community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) and install `n8n-nodes-origami-ms`.

## Credentials

The Origami API authenticates with a username and API secret sent in the request body.

1. In Origami, open **Settings → General Settings → Developer**, enable the API and copy the username and `OGMI-…` secret.
2. In n8n, create an **Origami API** credential.
3. **Account Name** is your Origami subdomain (`mycompany` for `https://mycompany.origami.ms`). Use **Custom Base URL** for a white-label domain.
4. **AI Agent Access** (default **Read Only**) applies only when the node is connected to an n8n AI Agent as a tool. Read Only lets the agent list, get and download. Create, update, delete, archive, upload, invoices, email, SMS, push and omnichannel need **Read and Write**. Regular workflow nodes are not affected. Use separate credentials for different trust levels.

**Test connection** calls the entities list and fails on Origami's `HTTP 200 { "error": … }` login responses.

## Discover, then operate

Entity, group and field ids (`e_*`, `g_*`, `fld_*`) are per account. Pick them from the dropdowns, which load your account structure live:

- Entity picker (searchable)
- Group picker (repeatable groups only for Repeatable Group operations)
- Field picker (create: fields in the selected group; update: writable fields; filters: all fields; upload: file fields)

Typical flow:

1. **Entity → Get Many** to list entities
2. **Entity → Get Structure** (or **Record → Get Form Template**) for field names
3. **Record → Get Many / Create / Update** using those names

## Resources

| Resource | Operations |
|---|---|
| Entity | Get Many, Get Structure |
| Record | Get Form Template, Create, Get, Get Many, Update, Delete, Archive, Unarchive, Get History |
| Repeatable Group | Add, Remove |
| File | Upload, Download |
| Invoice | Get Structure, Create, Get, Get Many |
| Communication | Send Email, Send SMS, Send Push |
| Omnichannel | Ingest Message |
| Calendar | Get View Details |
| Origami Trigger | Webhook from an Origami workflow HTTP action |

## Behavior notes

- **Errors**: Origami can answer `HTTP 200` with `{ "error": … }`. The node treats that as a failure (or an error item with Continue On Fail).
- **Pagination**: Origami pages with `limit: [skip, count]`. **Return All** pages 100 at a time, sorted by `_id` ascending unless you set Order By, so records created during the run do not shift pages. It stops at **Max Records** (default 5000) and shows a warning in the output pane when more rows exist.
- **Get by ID** also finds archived records. **Get Many** excludes archived records unless Include Archived is on.
- **File upload**: Origami file fields hold one file. Uploading replaces the file currently in the field.
- **Trigger**: set Auth Header Name and Value in the node and send that header from the Origami workflow HTTP action. A missing or wrong header returns 401.

### API flags

| Flag | Where | Notes |
|---|---|---|
| `force_workflow_async` | Create, Update, Repeatable Add | Run Origami workflows asynchronously so the write does not fail on workflow errors |
| `normalized` | Get / Get Many | Default on. Off keeps nested values such as phone normalization |
| `return_fields` / `return_groups` | Get / Get Many | Return only those fields or groups |
| `orderby` | Get Many | `fld_x,desc` or JSON `["_id","desc"]` |
| `with_archive` | Get Many | Off sends `0` (exclude archived) |
| `dont_recalc_formula` / `with_comments` | Get / Get Many | Skip formula recalculation; include comments |
| `round_total` / `saved_id` / `attach_type` | Invoice Create | Round totals, issue a saved draft, credit note parent type (`manual` = no parent) |

### Invoices

Types: `deal_invoice`, `tax_invoice`, `tax_receipt`, `receipt`, `refund_invoice`, `delivery_note`, `work_order`.

- Unit Price is always before VAT. **Charge VAT** (default on) adds Tax Percent on top. Off issues the line without VAT.
- Origami recomputes line price, VAT and document totals.
- Currency tokens are `NIS`, `USD`, `EURO`.
- Customer and item ids must belong to the catalog of the selected company.
- Creating a tax invoice or receipt issues a real tax document. Test on a sandbox account first.

## Development

```bash
npm ci
npm run lint
npm run test:all   # unit tests + execute-level tests against the compiled node
npm run build
```

## Resources

- [Origami API reference (Postman)](https://documenter.getpostman.com/view/2653695/2s93kz65gS)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## License

[MIT](LICENSE)
