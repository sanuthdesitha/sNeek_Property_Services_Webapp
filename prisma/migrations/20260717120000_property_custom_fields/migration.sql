-- Values for admin-defined custom property intake fields.
-- Definitions live in the `propertyFormConfig` AppSetting; this column stores the
-- captured values: { [customFieldId]: string | number | boolean | {url,key} }.
ALTER TABLE "Property" ADD COLUMN "customFields" JSONB;
