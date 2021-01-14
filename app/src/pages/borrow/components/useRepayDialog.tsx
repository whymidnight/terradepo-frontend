import { fabricateRepay } from '@anchor-protocol/anchor-js/fabricators';
import { ActionButton } from '@anchor-protocol/neumorphism-ui/components/ActionButton';
import { Dialog } from '@anchor-protocol/neumorphism-ui/components/Dialog';
import { NumberInput } from '@anchor-protocol/neumorphism-ui/components/NumberInput';
import { Tooltip } from '@anchor-protocol/neumorphism-ui/components/Tooltip';
import {
  formatPercentage,
  formatUST,
  MICRO,
  UST_INPUT_MAXIMUM_DECIMAL_POINTS,
} from '@anchor-protocol/notation';
import {
  BroadcastableQueryOptions,
  useBroadcastableQuery,
} from '@anchor-protocol/use-broadcastable-query';
import type {
  DialogProps,
  DialogTemplate,
  OpenDialog,
} from '@anchor-protocol/use-dialog';
import { useDialog } from '@anchor-protocol/use-dialog';
import { useWallet, WalletStatus } from '@anchor-protocol/wallet-provider';
import { ApolloClient, useApolloClient } from '@apollo/client';
import { InputAdornment, Modal } from '@material-ui/core';
import { InfoOutlined } from '@material-ui/icons';
import { CreateTxOptions } from '@terra-money/terra.js';
import * as txi from 'api/queries/txInfos';
import { queryOptions } from 'api/transactions/queryOptions';
import {
  parseResult,
  StringifiedTxResult,
  TxResult,
} from 'api/transactions/tx';
import {
  txNotificationFactory,
  TxResultRenderer,
} from 'api/transactions/TxResultRenderer';
import big from 'big.js';
import { TxFeeList, TxFeeListItem } from 'components/messages/TxFeeList';
import { WarningArticle } from 'components/messages/WarningArticle';
import { BLOCKS_PER_YEAR } from 'constants/BLOCKS_PER_YEAR';
import { useBank } from 'contexts/bank';
import { useAddressProvider } from 'contexts/contract';
import { fixedGasUUSD, transactionFee } from 'env';
import { LTVGraph } from 'pages/borrow/components/LTVGraph';
import { Data as MarketOverview } from 'pages/borrow/queries/marketOverview';
import { Data as MarketUserOverview } from 'pages/borrow/queries/marketUserOverview';
import type { ReactNode } from 'react';
import React, { useCallback, useMemo, useState } from 'react';
import styled from 'styled-components';

interface FormParams {
  className?: string;
  marketOverview: MarketOverview;
  marketUserOverview: MarketUserOverview;
}

type FormReturn = void;

export function useRepayDialog(): [
  OpenDialog<FormParams, FormReturn>,
  ReactNode,
] {
  return useDialog(Template);
}

const Template: DialogTemplate<FormParams, FormReturn> = (props) => {
  return <Component {...props} />;
};

function ComponentBase({
  className,
  marketOverview,
  marketUserOverview,
  closeDialog,
}: DialogProps<FormParams, FormReturn>) {
  // ---------------------------------------------
  // dependencies
  // ---------------------------------------------
  const { status, post } = useWallet();

  const addressProvider = useAddressProvider();

  const [queryRepay, repayResult, resetRepayResult] = useBroadcastableQuery(
    repayQueryOptions,
  );

  const client = useApolloClient();

  // ---------------------------------------------
  // states
  // ---------------------------------------------
  const [assetAmount, setAssetAmount] = useState('');

  // ---------------------------------------------
  // queries
  // ---------------------------------------------
  const bank = useBank();

  // ---------------------------------------------
  // compute
  // ---------------------------------------------
  const userLtv = useMemo(() => {
    if (assetAmount.length === 0) {
      return undefined;
    }

    const userAmount = big(assetAmount).mul(MICRO);

    return big(
      big(marketUserOverview.loanAmount.loan_amount).minus(userAmount),
    ).div(
      big(
        big(marketUserOverview.borrowInfo.balance).minus(
          marketUserOverview.borrowInfo.spendable,
        ),
      ).mul(marketOverview.oraclePrice.rate),
    );
  }, [
    assetAmount,
    marketOverview.oraclePrice.rate,
    marketUserOverview.borrowInfo.balance,
    marketUserOverview.borrowInfo.spendable,
    marketUserOverview.loanAmount.loan_amount,
  ]);

  const apr = useMemo(() => {
    return big(marketOverview.borrowRate.rate).mul(BLOCKS_PER_YEAR);
  }, [marketOverview.borrowRate.rate]);

  const totalBorrows = useMemo(() => {
    return marketUserOverview.loanAmount.loan_amount;
  }, [marketUserOverview.loanAmount.loan_amount]);

  const txFee = useMemo(() => {
    if (assetAmount.length === 0) {
      return undefined;
    }

    const userAmount = big(assetAmount).mul(MICRO);

    const userAmountTxFee = userAmount.mul(bank.tax.taxRate);

    if (userAmountTxFee.gt(bank.tax.maxTaxUUSD)) {
      return big(bank.tax.maxTaxUUSD).plus(fixedGasUUSD);
    } else {
      return userAmountTxFee.plus(fixedGasUUSD);
    }
  }, [assetAmount, bank.tax.maxTaxUUSD, bank.tax.taxRate]);

  const totalOutstandingLoan = useMemo(() => {
    return assetAmount.length > 0
      ? big(marketUserOverview.loanAmount.loan_amount).minus(
          big(assetAmount).mul(MICRO),
        )
      : undefined;
  }, [assetAmount, marketUserOverview.loanAmount.loan_amount]);

  const estimatedAmount = useMemo(() => {
    return assetAmount.length > 0 && txFee
      ? big(big(assetAmount).mul(MICRO)).plus(txFee)
      : undefined;
  }, [assetAmount, txFee]);

  const invalidTxFee = useMemo(() => {
    if (bank.status === 'demo') {
      return undefined;
    } else if (big(bank.userBalances.uUSD ?? 0).lt(fixedGasUUSD)) {
      return 'Not enough Tx Fee';
    }
    return undefined;
  }, [bank.status, bank.userBalances.uUSD]);

  const invalidAssetAmount = useMemo<ReactNode>(() => {
    if (bank.status === 'demo') {
      return undefined;
    } else if (
      big(assetAmount.length > 0 ? assetAmount : 0)
        .mul(MICRO)
        .gt(totalBorrows)
    ) {
      return `Insufficient balance: Not enough Assets`;
    }
    return undefined;
  }, [assetAmount, bank.status, totalBorrows]);

  // ---------------------------------------------
  // callbacks
  // ---------------------------------------------
  const updateAssetAmount = useCallback((nextAssetAmount: string) => {
    setAssetAmount(nextAssetAmount);
  }, []);

  const proceed = useCallback(
    async ({
      status,
      assetAmount,
    }: {
      status: WalletStatus;
      assetAmount: string;
    }) => {
      if (status.status !== 'ready' || bank.status !== 'connected') {
        return;
      }

      await queryRepay({
        post: post<CreateTxOptions, StringifiedTxResult>({
          ...transactionFee,
          msgs: fabricateRepay({
            address: status.status === 'ready' ? status.walletAddress : '',
            market: 'ust',
            amount: assetAmount,
            borrower: undefined,
          })(addressProvider),
        }).then(({ payload }) => parseResult(payload)),
        client,
      });
    },
    [addressProvider, bank.status, client, post, queryRepay],
  );

  // ---------------------------------------------
  // presentation
  // ---------------------------------------------
  if (
    repayResult?.status === 'in-progress' ||
    repayResult?.status === 'done' ||
    repayResult?.status === 'error'
  ) {
    return (
      <Modal open disableBackdropClick>
        <Dialog className={className}>
          <h1>
            Repay<p>Borrow APR: {formatPercentage(apr.mul(100))}%</p>
          </h1>
          <TxResultRenderer
            result={repayResult}
            resetResult={() => {
              resetRepayResult && resetRepayResult();
              closeDialog();
            }}
          />
        </Dialog>
      </Modal>
    );
  }

  return (
    <Modal open>
      <Dialog className={className} onClose={() => closeDialog()}>
        <h1>
          Repay<p>Borrow APR: {formatPercentage(apr.mul(100))}%</p>
        </h1>

        {!!invalidTxFee && <WarningArticle>{invalidTxFee}</WarningArticle>}

        <NumberInput
          className="amount"
          value={assetAmount}
          maxDecimalPoints={UST_INPUT_MAXIMUM_DECIMAL_POINTS}
          label="REPAY AMOUNT"
          error={!!invalidAssetAmount}
          onChange={({ target }) => updateAssetAmount(target.value)}
          InputProps={{
            endAdornment: <InputAdornment position="end">UST</InputAdornment>,
          }}
        />

        <div className="wallet" aria-invalid={!!invalidAssetAmount}>
          <span>{invalidAssetAmount}</span>
          <span>
            Total Borrowed:{' '}
            <span
              style={{
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
              onClick={() =>
                updateAssetAmount(big(totalBorrows).div(MICRO).toString())
              }
            >
              {formatUST(big(totalBorrows ?? 0).div(MICRO))} UST
            </span>
          </span>
        </div>

        <figure className="graph">
          <LTVGraph maxLtv={marketOverview.bLunaMaxLtv} userLtv={userLtv} />
        </figure>

        {totalOutstandingLoan && txFee && estimatedAmount && (
          <TxFeeList className="receipt">
            <TxFeeListItem label="Total Outstanding Loan">
              {formatUST(big(totalOutstandingLoan).div(MICRO))} UST
            </TxFeeListItem>
            <TxFeeListItem
              label={
                <>
                  Tx Fee{' '}
                  <Tooltip title="Tx Fee Description" placement="top">
                    <InfoOutlined />
                  </Tooltip>
                </>
              }
            >
              {formatUST(big(txFee).div(MICRO))} UST
            </TxFeeListItem>
            <TxFeeListItem label="Estimated Amount">
              {formatUST(big(estimatedAmount).div(MICRO))} UST
            </TxFeeListItem>
          </TxFeeList>
        )}

        <ActionButton
          className="proceed"
          disabled={
            status.status !== 'ready' ||
            bank.status !== 'connected' ||
            assetAmount.length === 0 ||
            big(assetAmount).lte(0) ||
            !!invalidTxFee ||
            !!invalidAssetAmount
          }
          onClick={() => proceed({ status, assetAmount: assetAmount })}
        >
          Proceed
        </ActionButton>
      </Dialog>
    </Modal>
  );
}

const repayQueryOptions: BroadcastableQueryOptions<
  { post: Promise<TxResult>; client: ApolloClient<any> },
  { txResult: TxResult } & { txInfos: txi.Data },
  Error
> = {
  ...queryOptions,
  group: 'borrow/repay',
  notificationFactory: txNotificationFactory,
};

const Component = styled(ComponentBase)`
  width: 720px;

  h1 {
    font-size: 27px;
    text-align: center;
    font-weight: 300;

    p {
      font-size: 14px;
      margin-top: 10px;
    }

    margin-bottom: 50px;
  }

  .amount {
    width: 100%;
    margin-bottom: 5px;

    .MuiTypography-colorTextSecondary {
      color: currentColor;
    }
  }

  .wallet {
    display: flex;
    justify-content: space-between;

    font-size: 12px;
    color: ${({ theme }) => theme.dimTextColor};

    &[aria-invalid='true'] {
      color: #f5356a;
    }

    margin-bottom: 45px;
  }

  .limit {
    width: 100%;
    margin-bottom: 30px;
  }

  .graph {
    margin-bottom: 40px;
  }

  .receipt {
    margin-bottom: 30px;
  }

  .proceed {
    width: 100%;
    height: 60px;
    border-radius: 30px;
  }
`;