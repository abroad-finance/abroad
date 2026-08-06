#![no_std]

//! Confidential verifier registry for the Abroad deposit path.
//!
//! OpenZeppelin's `ConfidentialVerifier` trait deliberately ships **no** default
//! `verify_proof`: the UltraHonk backend lives outside the suite and is
//! unfinished. This contract supplies one by delegating, per circuit, to a
//! deployed `rs-soroban-ultrahonk` instance (Nethermind), which holds that
//! circuit's verification key immutably from its own deploy time.
//!
//! Delegation rather than linking is forced by versions — the backend is built
//! against soroban-sdk 26 and this suite against 27 — but it is also the right
//! shape: the backend contract is the audit surface for proof verification, and
//! keeping it addressable means it can be replaced without touching the token.
//!
//! The registry still stores each VK itself. That copy is what makes the
//! delegation auditable: anyone can read `get_verification_key` here, read
//! `vk_bytes` on the backend, and confirm the two agree and that both match the
//! key reproduced from the circuit source with the pinned toolchain.
//!
//! # Not production ready
//!
//! The backend is unaudited and its own authors say so. This registry inherits
//! that status wholesale and must not be pointed at anything holding real value.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, vec,
    Address, Bytes, Env, IntoVal, Symbol, Vec,
};
use stellar_access::access_control::{self as access_control, AccessControl};
use stellar_macros::only_role;
use stellar_tokens::confidential::verifier::{
    storage as verifier_storage, CircuitType, ConfidentialVerifier,
};

const MANAGER_ROLE: Symbol = symbol_short!("manager");

#[contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum RegistryError {
    /// No UltraHonk backend contract has been set for this circuit.
    BackendNotSet = 4400,
}

#[contracttype]
pub enum RegistryStorageKey {
    /// Deployed `rs-soroban-ultrahonk` instance serving one circuit.
    Backend(CircuitType),
}

#[contract]
pub struct AbroadConfidentialVerifier;

#[contractimpl]
impl AbroadConfidentialVerifier {
    pub fn __constructor(e: &Env, admin: Address, manager: Address) {
        access_control::set_admin(e, &admin);
        access_control::grant_role_no_auth(e, &manager, &MANAGER_ROLE, &admin);
    }

    /// Returns the backend serving `circuit_type`, so callers can audit the
    /// address they are actually trusting before relying on a verdict.
    pub fn backend(e: &Env, circuit_type: CircuitType) -> Address {
        Self::require_backend(e, circuit_type)
    }

    /// Points a circuit at the deployed UltraHonk instance that holds its VK.
    ///
    /// Soundness-critical in exactly the way `update_verification_key` is: a
    /// backend whose stored VK does not match this registry's copy will accept
    /// proofs for a different circuit.
    #[only_role(operator, "manager")]
    pub fn set_backend(e: &Env, circuit_type: CircuitType, backend: Address, operator: Address) {
        e.storage()
            .instance()
            .set(&RegistryStorageKey::Backend(circuit_type), &backend);
    }

    fn require_backend(e: &Env, circuit_type: CircuitType) -> Address {
        e.storage()
            .instance()
            .get::<_, Address>(&RegistryStorageKey::Backend(circuit_type))
            .unwrap_or_else(|| panic_with_error!(e, RegistryError::BackendNotSet))
    }
}

#[contractimpl(contracttrait)]
impl ConfidentialVerifier for AbroadConfidentialVerifier {
    #[only_role(operator, "manager")]
    fn register_verification_key(
        e: &Env,
        circuit_type: CircuitType,
        verification_key: Bytes,
        operator: Address,
    ) {
        verifier_storage::register_verification_key(e, circuit_type, &verification_key);
    }

    #[only_role(operator, "manager")]
    fn update_verification_key(
        e: &Env,
        circuit_type: CircuitType,
        new_verification_key: Bytes,
        operator: Address,
    ) {
        verifier_storage::update_verification_key(e, circuit_type, &new_verification_key);
    }

    /// Verifies `proof` against the circuit's registered key.
    ///
    /// Reading the VK first is not redundant: it enforces the trait's documented
    /// `VerificationKeyNotRegistered` failure, so a circuit whose key was never
    /// registered here cannot be verified through a backend set behind our back.
    fn verify_proof(
        e: &Env,
        circuit_type: CircuitType,
        public_inputs: Bytes,
        proof: Bytes,
    ) -> bool {
        let _registered = verifier_storage::get_verification_key(e, circuit_type);
        let backend = Self::require_backend(e, circuit_type);
        // `verify_proof` is 12 characters, past what `symbol_short!` can hold.
        let function = Symbol::new(e, "verify_proof");

        // The backend traps on a rejected proof rather than returning false, so a
        // failed invocation is the negative answer, not an error to propagate.
        e.try_invoke_contract::<(), soroban_sdk::Error>(
            &backend,
            &function,
            vec![e, public_inputs.into_val(e), proof.into_val(e)],
        )
        .is_ok()
    }
}

#[contractimpl(contracttrait)]
impl AccessControl for AbroadConfidentialVerifier {}
