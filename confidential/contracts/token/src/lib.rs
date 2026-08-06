#![no_std]

//! Confidential token deployment for the Abroad deposit path.
//!
//! A thin shell over OpenZeppelin's `ConfidentialToken`: the suite supplies every
//! entry point as a trait default, so all this contract does is bind the three
//! addresses the protocol needs and pin its own address as a field element.
//!
//! `NoHooks` is deliberate. The compliance extension (freezing, SAC
//! `authorized()` passthrough, external policy) belongs to a deployment that has
//! decided who the compliance authority is; a rail testing whether confidential
//! deposits work has not, and wiring an unowned policy hook would be worse than
//! wiring none.
//!
//! # Not production ready
//!
//! Proof verification routes to an unaudited UltraHonk backend. Testnet only.

use soroban_sdk::{contract, contractimpl, Address, Bytes, Env};
use stellar_tokens::confidential::{
    storage as token_storage, ConfidentialAccount, ConfidentialToken, NoHooks, SpenderDelegation,
};

#[contract]
pub struct AbroadConfidentialToken;

#[contractimpl]
impl AbroadConfidentialToken {
    /// Binds the wrapped SEP-41 asset, the verifier registry and the auditor
    /// registry. All three are immutable after construction, and
    /// `set_address_as_field_element` pins this contract's own address into the
    /// value every circuit binds its viewing-key derivation to.
    pub fn __constructor(e: &Env, token: Address, verifier: Address, auditor: Address) {
        token_storage::set_underlying_asset(e, &token);
        token_storage::set_verifier(e, &verifier);
        token_storage::set_auditor(e, &auditor);
        token_storage::set_address_as_field_element(e);
    }
}

#[contractimpl(contracttrait)]
impl ConfidentialToken for AbroadConfidentialToken {
    type Hooks = NoHooks;
}
