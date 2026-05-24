export interface AddressResult {
  formattedAddress: string;
  streetNumber?: string;
  route?: string;
  unit?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  country: string;
  lat: number;
  lng: number;
  placeId: string;
}
