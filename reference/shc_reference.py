"""
Reference SMART Health Card encoder for labkit.health.

This is the exact payload shape that was imported successfully into Apple Health
(iOS, 2026-09-23). The TypeScript implementation must produce byte-for-byte
equivalent payloads for the same input (see SPEC.md §8 and the golden test).

Synthetic data only. Never commit real patient data to this repo.

    pip install cryptography
    python shc_reference.py            # writes example.smart-health-card + example-payload.json
"""
import json, zlib, base64, hashlib, re
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

ISSUER = "https://staging.labkit.health"   # prod: https://labkit.health  (no trailing slash)
TYPES = ["https://smarthealth.cards#health-card", "https://smarthealth.cards#laboratory"]
LOINC, UCUM, SNOMED = "http://loinc.org", "http://unitsofmeasure.org", "http://snomed.info/sct"
CATEGORY = {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/observation-category",
                        "code": "laboratory", "display": "Laboratory"}]}
QUAL_CODES = {"negative": ("260385009", "Negative"), "positive": ("10828004", "Positive")}

b64u = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def jwk_thumbprint_kid(jwk: dict) -> str:
    # RFC 7638: required members only, lexicographic order, no whitespace
    canon = json.dumps({k: jwk[k] for k in ("crv", "kty", "x", "y")}, separators=(",", ":"), sort_keys=True)
    return b64u(hashlib.sha256(canon.encode()).digest())


def observation(r: dict, effective: str) -> dict:
    """r: {loinc, display, text, kind: quantity|qualitative|titer, value, unit?, comparator?, low?, high?}"""
    obs = {
        "resourceType": "Observation", "status": "final", "category": [CATEGORY],
        "code": {"coding": [{"system": LOINC, "code": r["loinc"], "display": r["display"]}], "text": r["text"]},
        "subject": {"reference": "resource:0"}, "effectiveDateTime": effective,
    }
    if r["kind"] == "quantity":
        q = {"value": r["value"], "unit": r["unit"], "system": UCUM, "code": r["unit"]}
        if r.get("comparator"):
            q["comparator"] = r["comparator"]
        obs["valueQuantity"] = q
        rr = {}
        if r.get("low") is not None:
            rr["low"] = {"value": r["low"], "unit": r["unit"]}
        if r.get("high") is not None:
            rr["high"] = {"value": r["high"], "unit": r["unit"]}
        if rr:
            obs["referenceRange"] = [rr]
    elif r["kind"] == "titer":
        obs["valueCodeableConcept"] = {"text": f"1:{r['value']}"}
    else:
        key = str(r["value"]).strip().lower()
        cc = {}
        if key in QUAL_CODES:
            code, disp = QUAL_CODES[key]
            cc["coding"] = [{"system": SNOMED, "code": code, "display": disp}]
        cc["text"] = str(r["value"])
        obs["valueCodeableConcept"] = cc
    return obs


def build_payload(patient: dict, effective: str, nbf: int, results: list[dict]) -> dict:
    entries = [{"fullUrl": "resource:0", "resource": {
        "resourceType": "Patient",
        "name": [{"family": patient["family"], "given": patient["given"]}],
        "birthDate": patient["birthDate"], **({"gender": patient["gender"]} if patient.get("gender") else {}),
    }}]
    for r in results:
        entries.append({"fullUrl": f"resource:{len(entries)}", "resource": observation(r, effective)})
    return {"iss": ISSUER, "nbf": nbf, "vc": {"type": TYPES, "credentialSubject": {
        "fhirVersion": "4.0.1",
        "fhirBundle": {"resourceType": "Bundle", "type": "collection", "entry": entries}}}}


def sign(payload: dict, key: ec.EllipticCurvePrivateKey, kid: str) -> str:
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
    c = zlib.compressobj(9, zlib.DEFLATED, -15)          # raw DEFLATE, no zlib header
    body = c.compress(raw) + c.flush()
    header = b64u(json.dumps({"zip": "DEF", "alg": "ES256", "kid": kid}, separators=(",", ":")).encode())
    signing_input = f"{header}.{b64u(body)}".encode()
    r, s = decode_dss_signature(key.sign(signing_input, ec.ECDSA(hashes.SHA256())))
    return f"{header}.{b64u(body)}.{b64u(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"  # raw r||s (JWS), not DER


def apple_redirect_url(jws: str) -> str:
    digits = "".join(f"{ord(ch) - 45:02d}" for ch in jws)   # SHC numeric mode
    return "https://redirect.health.apple.com/SMARTHealthCard/#" + digits


if __name__ == "__main__":
    key = ec.generate_private_key(ec.SECP256R1())
    n = key.public_key().public_numbers()
    jwk = {"kty": "EC", "crv": "P-256", "x": b64u(n.x.to_bytes(32, "big")), "y": b64u(n.y.to_bytes(32, "big"))}
    kid = jwk_thumbprint_kid(jwk)

    patient = {"family": "Doe", "given": ["Jordan"], "birthDate": "1985-01-15", "gender": "male"}
    results = [
        {"loinc": "1884-6", "display": "Apolipoprotein B [Mass/volume] in Serum or Plasma", "text": "Apolipoprotein B",
         "kind": "quantity", "value": 88, "unit": "mg/dL", "high": 90},
        {"loinc": "30522-7", "display": "C reactive protein [Mass/volume] in Serum or Plasma by High sensitivity method",
         "text": "hs-CRP", "kind": "quantity", "value": 0.2, "unit": "mg/L", "comparator": "<", "high": 1},
        {"loinc": "751-8", "display": "Neutrophils [#/volume] in Blood by Automated count", "text": "Neutrophils",
         "kind": "quantity", "value": 3.12, "unit": "10*3/uL", "low": 1.5, "high": 7.8},
        {"loinc": "8061-4", "display": "Nuclear Ab [Presence] in Serum", "text": "ANA screen",
         "kind": "qualitative", "value": "Negative"},
        {"loinc": "2514-8", "display": "Ketones [Presence] in Urine by Test strip", "text": "Urine ketones",
         "kind": "qualitative", "value": "1+"},
        {"loinc": "5048-4", "display": "Nuclear Ab [Titer] in Serum by Immunofluorescence", "text": "ANA titer",
         "kind": "titer", "value": 40},
    ]
    payload = build_payload(patient, "2026-04-17T13:40:00Z", 1776433200, results)
    jws = sign(payload, key, kid)
    json.dump({"verifiableCredential": [jws]}, open("example.smart-health-card", "w"), separators=(",", ":"))
    json.dump(payload, open("example-payload.json", "w"), indent=2)
    json.dump({"keys": [dict(jwk, kid=kid, use="sig", alg="ES256")]}, open("example-jwks.json", "w"), indent=2)
    print("kid", kid, "| jws bytes", len(jws), "| redirect url chars", len(apple_redirect_url(jws)))
