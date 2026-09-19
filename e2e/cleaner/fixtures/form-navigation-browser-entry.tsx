import React from "react";
import { createRoot } from "react-dom/client";
import { FormRenderer } from "@/components/v2/cleaner/form-renderer";
import { FormNavigation } from "@/components/v2/cleaner/form-navigation";
import { formNavigation } from "@/lib/forms/navigation";

const schema: any = { sections: [
  { id: "kitchen", title: "Kitchen", fields: [{ id: "kitchen_note", type: "text", label: "Kitchen note", required: true }] },
  { id: "bedroom", title: "Bedroom", fields: [{ id: "bedroom_note", type: "text", label: "Bedroom note", required: true }] },
  { id: "laundry", title: "Laundry", conditional: { fieldId: "laundry_ready", value: true }, fields: [{ id: "laundry_note", type: "text", label: "Laundry note", required: true }] },
] };
function Fixture() {
  const [answers, setAnswers] = React.useState<Record<string, unknown>>({});
  const [ready, setReady] = React.useState(false);
  const navigation = formNavigation(schema, answers, {}, {}, ready);
  return <><button onClick={() => setReady(value => !value)}>Toggle laundry ready</button>
    <output data-testid="answers">{JSON.stringify(answers)}</output>
    <FormNavigation navigation={navigation}/>
    <FormRenderer schema={schema} answers={answers} uploads={{}} property={{}} laundryReady={ready}
      onAnswer={(id, value) => setAnswers(previous => ({ ...previous, [id]: value }))} onUpload={() => {}}
      collapsibleSections sectionProgress={id => navigation.rooms.find(room => room.id === id)}/></>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
