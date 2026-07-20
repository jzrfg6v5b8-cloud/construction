# @sharkflows/space-schema

Versioned TypeScript and Zod contracts for space configuration, model export,
materials, products, SKU data, and bills of materials.

All geometry lengths and coordinates are integer millimeters. Area fields use
integer square millimeters. The protocol version is exported as
`SPACE_PROTOCOL_VERSION`.

## Usage

```ts
import {
  SpaceConfigurationSchema,
  validateSpaceConfigurationUpdate,
} from "@sharkflows/space-schema";

const configuration = SpaceConfigurationSchema.parse(input);
const update = validateSpaceConfigurationUpdate(configuration, candidate);
```

`validateSpaceConfigurationUpdate` prevents unreviewed or low-confidence
geometry from replacing verified dimensions and requires a new
`geometryVersion` for dimensional changes.

The published package also exposes:

- `@sharkflows/space-schema/schema.json`
- `@sharkflows/space-schema/examples/A03023.json`
