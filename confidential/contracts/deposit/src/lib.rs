#![no_std]

//! Attributes a confidential transfer to an Abroad transaction.
//!
//! Abroad has one deposit account and correlates every deposit to a transaction
//! by memo. Soroban transactions **cannot carry a memo** — the network rejects
//! any transaction that contains both a Soroban operation and one — so a
//! confidential deposit has no memo to correlate on. This contract restores the
//! correlation by carrying the reference as an explicit argument and forwarding
//! to the confidential token.
//!
//! `from.require_auth()` here is not redundant with the token's own check. It is
//! what binds the *reference* to the payer's authorization. Without it the
//! reference would be unauthenticated: an observer could take a pending
//! `data` blob and resubmit it under a different reference, crediting one
//! customer's deposit to another customer's transaction. Soroban authorization
//! covers the full invocation including its arguments, so signing `deposit`
//! signs the reference.
//!
//! The token address is fixed at construction. Pinning this contract's address
//! in Abroad's configuration therefore transitively pins the token it feeds.

use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, panic_with_error, vec, Address, Bytes,
    BytesN, Env, IntoVal, Symbol,
};

#[contracttype]
pub enum DepositStorageKey {
    /// The confidential token this contract forwards to. Immutable.
    Token,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfidentialDeposit {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    /// The Abroad transaction this deposit pays, as the transaction UUID's bytes.
    pub reference: BytesN<16>,
}

#[contract]
pub struct AbroadConfidentialDeposit;

#[contractimpl]
impl AbroadConfidentialDeposit {
    pub fn __constructor(e: &Env, token: Address) {
        e.storage().instance().set(&DepositStorageKey::Token, &token);
    }

    /// The confidential token this contract forwards to.
    pub fn token(e: &Env) -> Address {
        e.storage()
            .instance()
            .get::<_, Address>(&DepositStorageKey::Token)
            .unwrap_or_else(|| panic_with_error!(e, DepositError::TokenNotSet))
    }

    /// Forwards a confidential transfer, tagged with the Abroad transaction it pays.
    ///
    /// The transfer itself is unchanged — `data` is passed through untouched, so
    /// the proof, the commitment and every ciphertext are exactly what the payer
    /// built. This contract adds attribution, not cryptography.
    pub fn deposit(e: &Env, reference: BytesN<16>, from: Address, to: Address, data: Bytes) {
        from.require_auth();

        let token = Self::token(e);
        // `confidential_transfer` is 21 characters, past `symbol_short!`'s limit.
        let function = Symbol::new(e, "confidential_transfer");
        e.invoke_contract::<()>(
            &token,
            &function,
            vec![e, from.clone().into_val(e), to.clone().into_val(e), data.into_val(e)],
        );

        ConfidentialDeposit { from, reference, to }.publish(e);
    }
}

#[soroban_sdk::contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum DepositError {
    /// The contract was never constructed with a token address.
    TokenNotSet = 4500,
}
