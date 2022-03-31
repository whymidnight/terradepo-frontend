import React, { useCallback } from 'react';
import { useEarnWithdrawForm } from '@anchor-protocol/app-provider';
import { ActionButton } from '@libs/neumorphism-ui/components/ActionButton';
import { ViewAddressWarning } from 'components/ViewAddressWarning';
import { useAccount } from 'contexts/account';
import { WithdrawDialog } from '../WithdrawDialog';
import { useEarnWithdrawTx } from '@anchor-protocol/app-provider/tx/earn/withdraw';
import { aUST, u, UST } from '@anchor-protocol/types';
import { Big, BigSource } from 'big.js';
import { DialogProps } from '@libs/use-dialog';

export function TerraWithdrawDialog(props: DialogProps<{}, void>) {
  const { connected } = useAccount();

  const state = useEarnWithdrawForm();

  const [withdraw, withdrawTxResult] = useEarnWithdrawTx();

  const { withdrawAmount, txFee, availablePost } = state;

  const proceed = useCallback(
    async (withdrawAmount: UST, txFee: u<UST<BigSource>> | undefined) => {
      if (!connected || !withdraw) {
        return;
      }

      console.log(Big(withdrawAmount).toString(), withdrawAmount);
      withdraw({
        withdrawAmount: Big(withdrawAmount).toString() as aUST,
        txFee: txFee!.toString() as u<UST>,
      });
    },
    [connected, withdraw],
  );

  return (
    <WithdrawDialog {...props} {...state} txResult={withdrawTxResult}>
      <ViewAddressWarning>
        <ActionButton
          className="button"
          disabled={!availablePost || !connected || !withdraw || !availablePost}
          onClick={() => proceed(withdrawAmount, txFee)}
        >
          Proceed
        </ActionButton>
      </ViewAddressWarning>
    </WithdrawDialog>
  );
}
