"use client";

import type { WebsiteContent, WebsiteGalleryItem, WebsitePartner } from "@/lib/public-site/content";
import type { SectionProps } from "../types";
import {
  ESectionCard,
  EImageField,
  EListItem,
  EAddRow,
  EField,
  EInput,
  ETextarea,
  moveItem,
  uid,
} from "../shared";

export function MediaSection({ content, setContent, readOnly, uploadingKey, handleUpload }: SectionProps) {
  const setGallery = (p: Partial<WebsiteContent["gallery"]>) =>
    setContent((c) => ({ ...c, gallery: { ...c.gallery, ...p } }));
  const setPartners = (p: Partial<WebsiteContent["partners"]>) =>
    setContent((c) => ({ ...c, partners: { ...c.partners, ...p } }));
  const setSocial = (p: Partial<WebsiteContent["socialLinks"]>) =>
    setContent((c) => ({ ...c, socialLinks: { ...c.socialLinks, ...p } }));

  const gallery = content.gallery;
  const partners = content.partners;
  const social = content.socialLinks;

  const patchGallery = (i: number, p: Partial<WebsiteGalleryItem>) =>
    setGallery({ items: gallery.items.map((row, idx) => (idx === i ? { ...row, ...p } : row)) });
  const patchPartner = (i: number, p: Partial<WebsitePartner>) =>
    setPartners({ items: partners.items.map((row, idx) => (idx === i ? { ...row, ...p } : row)) });

  return (
    <div className="space-y-5">
      <ESectionCard title="Work gallery">
        <EField label="Section title">
          <EInput value={gallery.title} disabled={readOnly} onChange={(e) => setGallery({ title: e.target.value })} />
        </EField>
        <EField label="Section intro">
          <ETextarea rows={2} value={gallery.intro} disabled={readOnly} onChange={(e) => setGallery({ intro: e.target.value })} />
        </EField>
        <EAddRow
          hint="Gallery images with optional before/after"
          label="Add image"
          disabled={readOnly}
          onAdd={() =>
            setGallery({ items: [...gallery.items, { id: uid("gallery"), imageUrl: "", imageAlt: "", caption: "", serviceType: "" }] })
          }
        />
        {gallery.items.map((item, index) => (
          <EListItem
            key={item.id}
            index={index}
            count={gallery.items.length}
            title={item.caption || `Image ${index + 1}`}
            disabled={readOnly}
            onMoveUp={() => setGallery({ items: moveItem(gallery.items, index, -1) })}
            onMoveDown={() => setGallery({ items: moveItem(gallery.items, index, 1) })}
            onRemove={() => setGallery({ items: gallery.items.filter((_, i) => i !== index) })}
          >
            <EImageField
              label="Primary image"
              value={item.imageUrl}
              alt={item.imageAlt}
              disabled={readOnly}
              uploading={uploadingKey === `gallery-${item.id}`}
              onChange={(url) => patchGallery(index, { imageUrl: url })}
              onAltChange={(alt) => patchGallery(index, { imageAlt: alt })}
              onUpload={(file) => handleUpload(`gallery-${item.id}`, file, (url) => patchGallery(index, { imageUrl: url }))}
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <EImageField
                label="Before image"
                value={item.beforeImageUrl ?? ""}
                alt={item.imageAlt}
                disabled={readOnly}
                uploading={uploadingKey === `gallery-before-${item.id}`}
                onChange={(url) => patchGallery(index, { beforeImageUrl: url })}
                onAltChange={(alt) => patchGallery(index, { imageAlt: alt })}
                onUpload={(file) => handleUpload(`gallery-before-${item.id}`, file, (url) => patchGallery(index, { beforeImageUrl: url }))}
              />
              <EImageField
                label="After image"
                value={item.afterImageUrl ?? ""}
                alt={item.imageAlt}
                disabled={readOnly}
                uploading={uploadingKey === `gallery-after-${item.id}`}
                onChange={(url) => patchGallery(index, { afterImageUrl: url })}
                onAltChange={(alt) => patchGallery(index, { imageAlt: alt })}
                onUpload={(file) => handleUpload(`gallery-after-${item.id}`, file, (url) => patchGallery(index, { afterImageUrl: url }))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <EField label="Caption">
                <EInput value={item.caption} disabled={readOnly} onChange={(e) => patchGallery(index, { caption: e.target.value })} />
              </EField>
              <EField label="Service type label">
                <EInput value={item.serviceType} disabled={readOnly} onChange={(e) => patchGallery(index, { serviceType: e.target.value })} />
              </EField>
            </div>
          </EListItem>
        ))}
      </ESectionCard>

      <ESectionCard title="Partners & trusted suppliers">
        <EField label="Section title">
          <EInput value={partners.title} disabled={readOnly} onChange={(e) => setPartners({ title: e.target.value })} />
        </EField>
        <EAddRow
          hint="Partner entries (name, logo URL, website URL)"
          label="Add partner"
          disabled={readOnly}
          onAdd={() => setPartners({ items: [...partners.items, { id: uid("partner"), name: "", logoUrl: "", url: "" }] })}
        />
        {partners.items.map((item, index) => (
          <EListItem
            key={item.id}
            index={index}
            count={partners.items.length}
            title={item.name || `Partner ${index + 1}`}
            disabled={readOnly}
            onMoveUp={() => setPartners({ items: moveItem(partners.items, index, -1) })}
            onMoveDown={() => setPartners({ items: moveItem(partners.items, index, 1) })}
            onRemove={() => setPartners({ items: partners.items.filter((_, i) => i !== index) })}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <EField label="Name">
                <EInput value={item.name} disabled={readOnly} onChange={(e) => patchPartner(index, { name: e.target.value })} />
              </EField>
              <EField label="Logo URL">
                <EInput value={item.logoUrl} disabled={readOnly} onChange={(e) => patchPartner(index, { logoUrl: e.target.value })} />
              </EField>
              <EField label="Website URL">
                <EInput value={item.url} disabled={readOnly} onChange={(e) => patchPartner(index, { url: e.target.value })} />
              </EField>
            </div>
          </EListItem>
        ))}
      </ESectionCard>

      <ESectionCard
        title="Social media links"
        description="Shown in the footer and mobile menu. Leave blank to show greyed-out placeholder icons."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <EField label="WhatsApp number (digits only)" hint="e.g. 61451217210">
            <EInput value={social.whatsapp ?? ""} disabled={readOnly} placeholder="61451217210" onChange={(e) => setSocial({ whatsapp: e.target.value })} />
          </EField>
          <EField label="Instagram URL">
            <EInput value={social.instagram ?? ""} disabled={readOnly} placeholder="https://instagram.com/…" onChange={(e) => setSocial({ instagram: e.target.value })} />
          </EField>
          <EField label="Facebook URL">
            <EInput value={social.facebook ?? ""} disabled={readOnly} placeholder="https://facebook.com/…" onChange={(e) => setSocial({ facebook: e.target.value })} />
          </EField>
          <EField label="LinkedIn URL">
            <EInput value={social.linkedin ?? ""} disabled={readOnly} placeholder="https://linkedin.com/…" onChange={(e) => setSocial({ linkedin: e.target.value })} />
          </EField>
        </div>
      </ESectionCard>
    </div>
  );
}
